--!strict
--[[
	NexusClient — signierter HTTP-Zugriff auf die NEXUS-API.

	Zustaendig fuer:
	  * Signieren jeder Anfrage (HMAC-SHA256, Timestamp, Nonce)
	  * Wiederholversuche mit exponentiellem Backoff
	  * Aussetzen bei dauerhaften Fehlern (Circuit Breaker), damit ein
	    API-Ausfall nicht das Spielerlebnis stoert
	  * Uhrzeit-Ausgleich: die Serverzeit aus dem Handshake wird als Offset
	    verwendet, weil Roblox-Server leicht abweichen koennen

	Voraussetzungen im Spiel:
	  * "Allow HTTP Requests" in den Spieleinstellungen aktiviert
	  * Secret in ServerStorage (NIE in ReplicatedStorage)
]]

local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")

local NexusCrypto = require(script.Parent.NexusCrypto)

export type ClientConfig = {
	baseUrl: string,
	apiKey: string,
	signingSecret: string,
	universeId: string,
	debug: boolean?,
}

export type Response = {
	ok: boolean,
	status: number,
	body: { [string]: any },
	error: string?,
}

local NexusClient = {}
NexusClient.__index = NexusClient

export type NexusClient = typeof(setmetatable({} :: {
	config: ClientConfig,
	clockOffset: number,
	failureCount: number,
	circuitOpenUntil: number,
}, NexusClient))

function NexusClient.new(config: ClientConfig): NexusClient
	assert(RunService:IsServer(), "NexusClient darf nur auf dem Server laufen (Regel 53)")
	assert(config.baseUrl and #config.baseUrl > 0, "baseUrl fehlt")
	assert(config.signingSecret and #config.signingSecret >= 16, "signingSecret fehlt oder ist zu kurz")

	local ok, message = NexusCrypto.selfTest()
	assert(ok, "NexusCrypto-Selbsttest fehlgeschlagen: " .. tostring(message))

	return setmetatable({
		config = config,
		clockOffset = 0,
		failureCount = 0,
		circuitOpenUntil = 0,
	}, NexusClient)
end

function NexusClient:log(...: any)
	if self.config.debug then
		print("[NEXUS]", ...)
	end
end

--[[ Unix-Zeit inklusive Offset aus dem Handshake. ]]
function NexusClient:now(): number
	return math.floor(os.time() + self.clockOffset)
end

--[[
	Fuehrt eine signierte Anfrage aus.
	`path` muss mit "/" beginnen und exakt dem Pfad entsprechen, den die
	API sieht — er ist Teil der Signatur.
]]
function NexusClient:request(method: string, path: string, payload: { [string]: any }?): Response
	if os.clock() < self.circuitOpenUntil then
		return { ok = false, status = 0, body = {}, error = "circuit_open" }
	end

	local body = if payload then HttpService:JSONEncode(payload) else "{}"
	local timestamp = tostring(self:now())
	local nonce = NexusCrypto.nonce()
	local signature = NexusCrypto.sign(self.config.signingSecret, method, path, timestamp, nonce, body)

	local attempts = 0
	local lastError: string? = nil

	while attempts < 3 do
		attempts += 1

		local success, result = pcall(function()
			return HttpService:RequestAsync({
				Url = self.config.baseUrl .. path,
				Method = method,
				Headers = {
					["Content-Type"] = "application/json",
					["x-nexus-key"] = self.config.apiKey,
					["x-nexus-signature"] = signature,
					["x-nexus-timestamp"] = timestamp,
					["x-nexus-nonce"] = nonce,
					["x-nexus-game"] = self.config.universeId,
				},
				Body = body,
			})
		end)

		if success and result then
			local decoded: { [string]: any } = {}
			if result.Body and #result.Body > 0 then
				local decodeOk, decodedBody = pcall(HttpService.JSONDecode, HttpService, result.Body)
				if decodeOk then
					decoded = decodedBody
				end
			end

			if result.Success then
				self.failureCount = 0
				return { ok = true, status = result.StatusCode, body = decoded }
			end

			-- 4xx sind Anwendungsfehler: ein erneuter Versuch aendert nichts.
			-- Ausnahme 429 (Rate Limit) — dort lohnt sich Warten.
			if result.StatusCode >= 400 and result.StatusCode < 500 and result.StatusCode ~= 429 then
				self:log("Anfrage abgelehnt", path, result.StatusCode, result.Body)
				return {
					ok = false,
					status = result.StatusCode,
					body = decoded,
					error = tostring(decoded.error and decoded.error.code or result.StatusCode),
				}
			end

			lastError = "HTTP " .. tostring(result.StatusCode)
		else
			lastError = tostring(result)
		end

		task.wait(0.5 * 2 ^ (attempts - 1))
	end

	-- Nach wiederholten Fehlern kurz pausieren, statt weiter zu hämmern.
	self.failureCount += 1
	if self.failureCount >= 5 then
		self.circuitOpenUntil = os.clock() + 30
		self.failureCount = 0
		self:log("Circuit Breaker geoeffnet — 30 Sekunden Pause")
	end

	return { ok = false, status = 0, body = {}, error = lastError }
end

--[[
	Handshake: prueft Zugangsdaten und gleicht die Uhr ab.
	Der Zeitabgleich verhindert Ablehnungen wegen "clock_skew".
]]
function NexusClient:handshake(): Response
	local response = self:request("POST", "/api/v1/roblox/handshake", { jobId = game.JobId })
	if response.ok and response.body.serverTime then
		self.clockOffset = tonumber(response.body.serverTime) - os.time()
		self:log("Handshake erfolgreich, Zeitversatz:", self.clockOffset, "s")
	end
	return response
end

return NexusClient
