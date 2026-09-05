--!strict
--[[
	NexusServer — Laufzeit des NEXUS-SDK im Roblox-Spiel.

	Aufgaben:
	  * Heartbeat (Serverzustand, Spielerzahl, FPS)
	  * Ereignisse gebuendelt und idempotent uebertragen
	  * Kommandos aus Discord abholen und ausfuehren
	  * Verifizierungscodes serverseitig einloesen
	  * Belohnungen plattformuebergreifend anfordern

	Einbau (siehe docs/ROBLOX.md):
	  1. Ordner `luau` als ModuleScript-Baum nach ServerScriptService kopieren
	  2. In einem Server-Script:

	     local NexusServer = require(game.ServerScriptService.Nexus.NexusServer)
	     NexusServer.start({
	         baseUrl = "https://nexus.example.com",
	         apiKey = "nxs_live_...",
	         signingSecret = script.Parent.Secret.Value, -- ServerStorage!
	         universeId = tostring(game.GameId),
	     })

	Sicherheitsgrundsatz: Alles Sicherheitsrelevante geschieht hier auf dem
	Server. Der Client meldet nur Absichten (z. B. "ich moechte diesen Code
	einloesen"); Identitaet und Rechte bestimmt ausschliesslich der Server.
]]

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local HttpService = game:GetService("HttpService")

local NexusClient = require(script.Parent.NexusClient)

local NexusServer = {}

local client: NexusClient.NexusClient? = nil
local eventQueue: { { [string]: any } } = {}
local sessionStart: { [number]: number } = {}
local commandHandlers: { [string]: (payload: { [string]: any }) -> (boolean, string?) } = {}
local running = false

local HEARTBEAT_INTERVAL = 30
local EVENT_FLUSH_INTERVAL = 5
local COMMAND_POLL_INTERVAL = 5
local MAX_QUEUE = 200

--[[ Haengt ein Ereignis an die Warteschlange (idempotent ueber eventId). ]]
function NexusServer.pushEvent(eventType: string, payload: { [string]: any }?, player: Player?)
	if #eventQueue >= MAX_QUEUE then
		-- Aeltestes Ereignis verwerfen: lieber Daten verlieren als Speicher fluten.
		table.remove(eventQueue, 1)
	end
	table.insert(eventQueue, {
		eventId = HttpService:GenerateGUID(false),
		type = eventType,
		jobId = game.JobId,
		robloxUserId = if player then tostring(player.UserId) else nil,
		occurredAt = os.time(),
		payload = payload or {},
	})
end

--[[ Registriert einen Handler fuer ein Discord-Kommando. ]]
function NexusServer.onCommand(commandType: string, handler: (payload: { [string]: any }) -> (boolean, string?))
	commandHandlers[commandType] = handler
end

--[[
	Loest einen Verifizierungscode ein.
	Aufruf ausschliesslich vom Server — die UserId stammt aus dem
	Player-Objekt, nicht aus einer Client-Nachricht (Regel 53).
]]
function NexusServer.verifyPlayer(player: Player, code: string): (boolean, string)
	if not client then
		return false, "NEXUS ist nicht gestartet."
	end
	if typeof(code) ~= "string" or #code < 4 or #code > 40 then
		return false, "Ungueltiges Codeformat."
	end

	local response = client:request("POST", "/api/v1/roblox/verify", {
		code = code,
		robloxUserId = tostring(player.UserId),
		username = player.Name,
		displayName = player.DisplayName,
		jobId = game.JobId,
	})

	if not response.ok then
		return false, "Verifizierung derzeit nicht moeglich. Bitte spaeter erneut versuchen."
	end
	if response.body.ok ~= true then
		return false, tostring(response.body.message or "Ungueltiger Code.")
	end
	return true, tostring(response.body.message or "Verifizierung erfolgreich!")
end

--[[
	Fordert eine plattformuebergreifende Belohnung an.
	Der Idempotenzschluessel verhindert doppelte Gutschriften bei Retries.
]]
function NexusServer.claimReward(player: Player, rewardKey: string, idempotencyKey: string?): (boolean, string)
	if not client then
		return false, "NEXUS ist nicht gestartet."
	end
	local response = client:request("POST", "/api/v1/roblox/rewards/claim", {
		robloxUserId = tostring(player.UserId),
		rewardKey = rewardKey,
		idempotencyKey = idempotencyKey or (tostring(player.UserId) .. ":" .. rewardKey),
	})
	if not response.ok or response.body.ok ~= true then
		return false, tostring(response.body.message or "Belohnung konnte nicht gutgeschrieben werden.")
	end
	return true, if response.body.granted then "Belohnung gutgeschrieben!" else "Bereits erhalten."
end

local function measureFps(): number
	-- Mittelwert ueber die letzte Sekunde; RunService liefert Delta-Zeiten.
	local total = 0
	local samples = 0
	for _ = 1, 5 do
		total += RunService.Heartbeat:Wait()
		samples += 1
	end
	return if total > 0 then samples / total else 60
end

local function collectPlayers(): { { [string]: any } }
	local list = {}
	for _, player in Players:GetPlayers() do
		table.insert(list, {
			userId = tostring(player.UserId),
			username = player.Name,
			joinedAt = sessionStart[player.UserId] or os.time(),
		})
	end
	return list
end

local function sendHeartbeat()
	if not client then
		return
	end
	local stats = game:GetService("Stats")
	client:request("POST", "/api/v1/roblox/heartbeat", {
		jobId = game.JobId,
		placeId = tostring(game.PlaceId),
		playerCount = #Players:GetPlayers(),
		maxPlayers = Players.MaxPlayers,
		version = tostring(game.PlaceVersion),
		fps = measureFps(),
		memoryMb = stats:GetTotalMemoryUsageMb(),
		uptimeSeconds = math.floor(os.clock()),
		players = collectPlayers(),
	})
end

local function flushEvents()
	if not client or #eventQueue == 0 then
		return
	end

	-- Hoechstens 50 Ereignisse je Anfrage (Limit der API).
	local batch = {}
	for _ = 1, math.min(50, #eventQueue) do
		table.insert(batch, table.remove(eventQueue, 1))
	end

	local response = client:request("POST", "/api/v1/roblox/events", { events = batch })
	if not response.ok then
		-- Bei Fehlern zurueck in die Warteschlange: die eventId sorgt dafuer,
		-- dass ein spaeterer Doppelversand serverseitig erkannt wird.
		for index = #batch, 1, -1 do
			table.insert(eventQueue, 1, batch[index])
		end
	end
end

local function executeCommand(command: { [string]: any })
	local handler = commandHandlers[command.type]
	local ok: boolean
	local message: string?

	if handler then
		local success, result, resultMessage = pcall(handler, command.payload or {})
		if success then
			ok = result == true
			message = resultMessage
		else
			ok = false
			message = tostring(result)
		end
	else
		ok = false
		message = "Kein Handler fuer " .. tostring(command.type)
	end

	if client then
		client:request("POST", "/api/v1/roblox/commands/ack", {
			commandId = command.id,
			ok = ok,
			message = message,
		})
	end
end

local function pollCommands()
	if not client then
		return
	end
	local response = client:request("POST", "/api/v1/roblox/commands", { jobId = game.JobId })
	if not response.ok or typeof(response.body.commands) ~= "table" then
		return
	end
	for _, command in response.body.commands do
		task.spawn(executeCommand, command)
	end
end

--[[ Standard-Handler fuer die von NEXUS unterstuetzten Kommandos. ]]
local function registerDefaultHandlers()
	NexusServer.onCommand("ANNOUNCE", function(payload)
		local message = tostring(payload.message or "")
		if #message == 0 then
			return false, "leere Nachricht"
		end
		-- Ankuendigung an alle Clients: das Spiel entscheidet ueber die Darstellung.
		local remote = game:GetService("ReplicatedStorage"):FindFirstChild("NexusAnnounce")
		if remote and remote:IsA("RemoteEvent") then
			remote:FireAllClients(message, payload.author)
		end
		return true, "zugestellt"
	end)

	NexusServer.onCommand("KICK_PLAYER", function(payload)
		local target = Players:GetPlayerByUserId(tonumber(payload.robloxUserId) or 0)
		if not target then
			return false, "Spieler nicht auf diesem Server"
		end
		target:Kick("[NEXUS] " .. tostring(payload.reason or "Vom Moderationsteam entfernt"))
		return true, "gekickt"
	end)

	NexusServer.onCommand("BAN_PLAYER", function(payload)
		-- Die dauerhafte Sperre gehoert in den DataStore des Spiels; hier wird
		-- der Spieler entfernt, falls er gerade online ist.
		local target = Players:GetPlayerByUserId(tonumber(payload.robloxUserId) or 0)
		if target then
			target:Kick("[NEXUS] Gesperrt: " .. tostring(payload.reason or ""))
		end
		return true, "Bannliste aktualisieren (Spiel-DataStore)"
	end)

	NexusServer.onCommand("SHUTDOWN", function(payload)
		local reason = tostring(payload.reason or "Wartung")
		for _, player in Players:GetPlayers() do
			player:Kick("[NEXUS] Server wird heruntergefahren: " .. reason)
		end
		task.delay(3, function()
			-- Nach dem Entfernen aller Spieler beendet Roblox die Instanz selbst.
			NexusServer.stop()
		end)
		return true, "Shutdown eingeleitet"
	end)
end

--[[ Startet die Laufzeit. Mehrfachaufrufe sind wirkungslos. ]]
function NexusServer.start(config: NexusClient.ClientConfig)
	assert(RunService:IsServer(), "NexusServer darf nur auf dem Server laufen")
	if running then
		return
	end
	running = true

	client = NexusClient.new(config)
	registerDefaultHandlers()

	local handshake = (client :: NexusClient.NexusClient):handshake()
	if not handshake.ok then
		warn("[NEXUS] Handshake fehlgeschlagen: " .. tostring(handshake.error) ..
			" — Heartbeats werden trotzdem versucht.")
	end

	Players.PlayerAdded:Connect(function(player)
		sessionStart[player.UserId] = os.time()
		NexusServer.pushEvent("PLAYER_JOIN", {
			accountAge = player.AccountAge,
			membershipType = tostring(player.MembershipType),
		}, player)
	end)

	Players.PlayerRemoving:Connect(function(player)
		local joinedAt = sessionStart[player.UserId]
		sessionStart[player.UserId] = nil
		NexusServer.pushEvent("PLAYER_LEAVE", {
			sessionSeconds = if joinedAt then os.time() - joinedAt else 0,
		}, player)
	end)

	game:BindToClose(function()
		NexusServer.pushEvent("SERVER_SHUTDOWN", { jobId = game.JobId })
		flushEvents()
	end)

	task.spawn(function()
		while running do
			sendHeartbeat()
			task.wait(HEARTBEAT_INTERVAL)
		end
	end)

	task.spawn(function()
		while running do
			flushEvents()
			task.wait(EVENT_FLUSH_INTERVAL)
		end
	end)

	task.spawn(function()
		while running do
			pollCommands()
			task.wait(COMMAND_POLL_INTERVAL)
		end
	end)

	NexusServer.pushEvent("SERVER_START", { placeVersion = game.PlaceVersion })
	print("[NEXUS] SDK gestartet — Universe " .. config.universeId)
end

function NexusServer.stop()
	running = false
	client = nil
end

return NexusServer
