const keyCache = new Map()

function internalSecurityHeaders(headers = new Headers()) {
  headers.set("cache-control", "private, no-store, max-age=0")
  headers.set("content-security-policy", "default-src 'self'; base-uri 'none'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'")
  headers.set("cross-origin-resource-policy", "same-origin")
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()")
  headers.set("referrer-policy", "no-referrer")
  headers.set("strict-transport-security", "max-age=31536000; includeSubDomains")
  headers.set("x-content-type-options", "nosniff")
  headers.set("x-frame-options", "DENY")
  headers.set("x-robots-tag", "noindex, nofollow, noarchive")
  return headers
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: internalSecurityHeaders(new Headers({ "content-type": "application/json; charset=utf-8" }))
  })
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=")
  const binary = atob(normalized)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

function decodeJsonSegment(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)))
}

function normalizeTeamDomain(value = "") {
  return value.replace(/^https?:\/\//, "").replace(/\/$/, "")
}

async function getVerificationKey(teamDomain, keyId) {
  const cacheKey = `${teamDomain}:${keyId}`
  const cached = keyCache.get(cacheKey)
  if (cached?.expiresAt > Date.now()) return cached.key

  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, {
    headers: { accept: "application/json" }
  })
  if (!response.ok) throw new Error("Unable to load Cloudflare Access signing keys")
  const keySet = await response.json()
  const jwk = keySet.keys?.find(key => key.kid === keyId)
  if (!jwk) throw new Error("Cloudflare Access signing key was not found")

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  )
  keyCache.set(cacheKey, { key, expiresAt: Date.now() + 60 * 60 * 1000 })
  return key
}

function claimIncludesAudience(claim, expected) {
  return Array.isArray(claim) ? claim.includes(expected) : claim === expected
}

async function verifyOwner(request, env) {
  const teamDomain = normalizeTeamDomain(env.CF_ACCESS_TEAM_DOMAIN)
  const expectedAudience = String(env.CF_ACCESS_AUD || "").trim()
  const owners = new Set((env.OWNER_EMAILS || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean))
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(teamDomain) || !expectedAudience || !owners.size) {
    return { ok: false, status: 503, reason: "Owner authentication is not configured" }
  }

  const token = request.headers.get("Cf-Access-Jwt-Assertion")
  if (!token) return { ok: false, status: 401, reason: "Cloudflare Access login required" }
  if (token.length > 16384) return { ok: false, status: 401, reason: "Invalid access assertion" }
  const segments = token.split(".")
  if (segments.length !== 3) return { ok: false, status: 401, reason: "Invalid access assertion" }

  try {
    const header = decodeJsonSegment(segments[0])
    const claims = decodeJsonSegment(segments[1])
    if (header.alg !== "RS256" || !header.kid) throw new Error("Unsupported access assertion")
    const key = await getVerificationKey(teamDomain, header.kid)
    const signatureValid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      decodeBase64Url(segments[2]),
      new TextEncoder().encode(`${segments[0]}.${segments[1]}`)
    )
    const now = Math.floor(Date.now() / 1000)
    const expiresAt = Number(claims.exp)
    const notBefore = claims.nbf == null ? null : Number(claims.nbf)
    const issuer = `https://${teamDomain}`
    if (
      !signatureValid ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= now ||
      (notBefore !== null && (!Number.isFinite(notBefore) || notBefore > now)) ||
      claims.iss !== issuer ||
      !claimIncludesAudience(claims.aud, expectedAudience)
    ) {
      throw new Error("Access assertion validation failed")
    }
    const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : ""
    if (!owners.has(email)) return { ok: false, status: 403, reason: "This identity is not authorized as a Cadenzai owner" }
    return { ok: true, identity: { email, name: claims.name || email, subject: claims.sub } }
  } catch (error) {
    console.warn("Owner assertion rejected", error)
    return { ok: false, status: 401, reason: "Cloudflare Access assertion was rejected" }
  }
}

async function serveInternal(request, env, url) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    const response = json({ error: "Method not allowed" }, 405)
    response.headers.set("allow", "GET, HEAD")
    return response
  }
  const auth = await verifyOwner(request, env)
  if (!auth.ok) return json({ error: auth.reason }, auth.status)
  if (url.pathname === "/internal/api/session") return json({ authenticated: true, owner: auth.identity })
  if (url.pathname === "/internal") return Response.redirect(`${url.origin}/internal/`, 302)

  const assetUrl = new URL(request.url)
  if (assetUrl.pathname === "/internal/") assetUrl.pathname = "/internal/index.html"
  const response = await env.ASSETS.fetch(new Request(assetUrl, request))
  const headers = internalSecurityHeaders(new Headers(response.headers))
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const normalizedPath = url.pathname.toLowerCase()
    if (normalizedPath === "/internal" || normalizedPath.startsWith("/internal/")) {
      return serveInternal(request, env, url)
    }
    return env.ASSETS.fetch(request)
  }
}
