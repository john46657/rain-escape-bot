--!strict
--[[
	NexusCrypto — SHA-256 und HMAC-SHA256 in reinem Luau.

	Warum eigene Implementierung?
	Roblox stellt keine HMAC-Funktion bereit. `HttpService` kann zwar
	signieren lassen, aber nur mit Roblox-eigenen Diensten. Fuer die
	Authentifizierung gegenueber NEXUS wird HMAC-SHA256 benoetigt.

	Sicherheitshinweise:
	  * Dieses Modul darf ausschliesslich in Server-Skripten laufen.
	    Ein LocalScript haette Zugriff auf das Secret (Regel 53).
	  * Das Secret gehoert in ServerStorage bzw. eine Server-Konfiguration,
	    niemals in ReplicatedStorage.

	Das Ergebnis stimmt bitgenau mit Node.js `createHmac('sha256', key)`
	ueberein — beide Seiten erzeugen dieselbe Signatur.
]]

local NexusCrypto = {}

-- SHA-256-Rundenkonstanten (erste 32 Bit der Nachkommastellen der
-- Kubikwurzeln der ersten 64 Primzahlen).
local K = {
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
	0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
	0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
	0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
	0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
	0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
}

local band, bor, bxor, bnot = bit32.band, bit32.bor, bit32.bxor, bit32.bnot
local rrotate, rshift, lshift = bit32.rrotate, bit32.rshift, bit32.lshift

local function toBytes(value: number, length: number): string
	local bytes = table.create(length)
	for index = length, 1, -1 do
		bytes[index] = string.char(band(value, 0xff))
		value = rshift(value, 8)
	end
	return table.concat(bytes)
end

--[[ Vorbereitung: Padding nach FIPS 180-4 (Anhang B). ]]
local function preprocess(message: string): string
	local length = #message
	local bitLength = length * 8
	local padded = message .. "\128"
	local zeros = (56 - (#padded % 64)) % 64
	padded ..= string.rep("\0", zeros)
	-- Laenge als 64-Bit-Big-Endian. Nachrichten > 512 MB kommen hier nicht vor,
	-- daher genuegen die unteren 32 Bit plus vier Nullbytes.
	padded ..= "\0\0\0\0" .. toBytes(bitLength, 4)
	return padded
end

--[[ Berechnet den SHA-256-Digest als rohe 32-Byte-Zeichenkette. ]]
function NexusCrypto.sha256Raw(message: string): string
	local h0, h1, h2, h3 = 0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a
	local h4, h5, h6, h7 = 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19

	local padded = preprocess(message)
	local w = table.create(64, 0)

	for chunkStart = 1, #padded, 64 do
		for index = 0, 15 do
			local offset = chunkStart + index * 4
			w[index + 1] = bor(
				lshift(string.byte(padded, offset), 24),
				lshift(string.byte(padded, offset + 1), 16),
				lshift(string.byte(padded, offset + 2), 8),
				string.byte(padded, offset + 3)
			)
		end

		for index = 17, 64 do
			local previous15 = w[index - 15]
			local previous2 = w[index - 2]
			local s0 = bxor(rrotate(previous15, 7), rrotate(previous15, 18), rshift(previous15, 3))
			local s1 = bxor(rrotate(previous2, 17), rrotate(previous2, 19), rshift(previous2, 10))
			w[index] = band(w[index - 16] + s0 + w[index - 7] + s1, 0xffffffff)
		end

		local a, b, c, d, e, f, g, h = h0, h1, h2, h3, h4, h5, h6, h7

		for index = 1, 64 do
			local s1 = bxor(rrotate(e, 6), rrotate(e, 11), rrotate(e, 25))
			local ch = bxor(band(e, f), band(bnot(e), g))
			local temp1 = band(h + s1 + ch + K[index] + w[index], 0xffffffff)
			local s0 = bxor(rrotate(a, 2), rrotate(a, 13), rrotate(a, 22))
			local maj = bxor(band(a, b), band(a, c), band(b, c))
			local temp2 = band(s0 + maj, 0xffffffff)

			h, g, f = g, f, e
			e = band(d + temp1, 0xffffffff)
			d, c, b = c, b, a
			a = band(temp1 + temp2, 0xffffffff)
		end

		h0 = band(h0 + a, 0xffffffff)
		h1 = band(h1 + b, 0xffffffff)
		h2 = band(h2 + c, 0xffffffff)
		h3 = band(h3 + d, 0xffffffff)
		h4 = band(h4 + e, 0xffffffff)
		h5 = band(h5 + f, 0xffffffff)
		h6 = band(h6 + g, 0xffffffff)
		h7 = band(h7 + h, 0xffffffff)
	end

	return toBytes(h0, 4) .. toBytes(h1, 4) .. toBytes(h2, 4) .. toBytes(h3, 4)
		.. toBytes(h4, 4) .. toBytes(h5, 4) .. toBytes(h6, 4) .. toBytes(h7, 4)
end

local function toHex(raw: string): string
	return (raw:gsub(".", function(character)
		return string.format("%02x", string.byte(character))
	end))
end

function NexusCrypto.sha256(message: string): string
	return toHex(NexusCrypto.sha256Raw(message))
end

--[[
	HMAC-SHA256 nach RFC 2104.
	Rueckgabe: Hex-String (Kleinbuchstaben) — identisch zu Node.js.
]]
function NexusCrypto.hmacSha256(key: string, message: string): string
	local blockSize = 64

	if #key > blockSize then
		key = NexusCrypto.sha256Raw(key)
	end
	if #key < blockSize then
		key ..= string.rep("\0", blockSize - #key)
	end

	local outerPad = table.create(blockSize)
	local innerPad = table.create(blockSize)
	for index = 1, blockSize do
		local byte = string.byte(key, index)
		outerPad[index] = string.char(bxor(byte, 0x5c))
		innerPad[index] = string.char(bxor(byte, 0x36))
	end

	local innerHash = NexusCrypto.sha256Raw(table.concat(innerPad) .. message)
	return toHex(NexusCrypto.sha256Raw(table.concat(outerPad) .. innerHash))
end

--[[
	Kanonische Zeichenkette des NEXUS-Protokolls.
	Muss exakt `packages/security/src/signing.ts` entsprechen:
		METHOD \n PATH \n TIMESTAMP \n NONCE \n BODY
]]
function NexusCrypto.canonicalString(method: string, path: string, timestamp: string, nonce: string, body: string): string
	return string.upper(method) .. "\n" .. path .. "\n" .. timestamp .. "\n" .. nonce .. "\n" .. body
end

function NexusCrypto.sign(secret: string, method: string, path: string, timestamp: string, nonce: string, body: string): string
	return NexusCrypto.hmacSha256(secret, NexusCrypto.canonicalString(method, path, timestamp, nonce, body))
end

--[[ Zufaellige Nonce (Replay-Schutz). Kollisionen sind praktisch ausgeschlossen. ]]
function NexusCrypto.nonce(): string
	local characters = "abcdefghijklmnopqrstuvwxyz0123456789"
	local parts = table.create(24)
	for index = 1, 24 do
		local position = math.random(1, #characters)
		parts[index] = string.sub(characters, position, position)
	end
	return table.concat(parts) .. tostring(os.clock()):gsub("%.", "")
end

--[[
	Selbsttest mit den offiziellen Testvektoren.
	Wird beim Start einmal ausgefuehrt: ein stiller Krypto-Fehler waere
	schlimmer als ein lauter Startabbruch.
]]
function NexusCrypto.selfTest(): (boolean, string?)
	local emptyHash = NexusCrypto.sha256("")
	if emptyHash ~= "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" then
		return false, "SHA-256 Testvektor (leer) fehlgeschlagen: " .. emptyHash
	end

	local abcHash = NexusCrypto.sha256("abc")
	if abcHash ~= "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" then
		return false, "SHA-256 Testvektor (abc) fehlgeschlagen: " .. abcHash
	end

	-- RFC 4231, Testfall 1
	local hmac = NexusCrypto.hmacSha256(string.rep("\11", 20), "Hi There")
	if hmac ~= "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7" then
		return false, "HMAC-SHA256 Testvektor fehlgeschlagen: " .. hmac
	end

	return true, nil
end

return NexusCrypto
