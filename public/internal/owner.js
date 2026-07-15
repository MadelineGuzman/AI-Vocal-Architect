fetch("./api/session", { credentials: "same-origin" })
  .then(response => response.ok ? response.json() : Promise.reject(new Error("Owner session unavailable")))
  .then(session => { document.getElementById("owner").textContent = session.owner.email })
  .catch(() => { document.getElementById("owner").textContent = "Authentication required" })
