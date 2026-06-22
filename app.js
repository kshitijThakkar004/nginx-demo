const state = {
  activeDomainId: null,
  activeRequestHost: null,
  requestMode: "manual",
  manualRequest: null,
  packetAnimationFrame: null,
  showConfig: true,
  testStatus: "ok",
  domains: []
};

const els = {
  domainForm: document.querySelector("#domainForm"),
  domainInput: document.querySelector("#domainInput"),
  deleteDomainButton: document.querySelector("#deleteDomainButton"),
  sslDomainSelect: document.querySelector("#sslDomainSelect"),
  issueSslButton: document.querySelector("#issueSslButton"),
  configForm: document.querySelector("#configForm"),
  configDomainSelect: document.querySelector("#configDomainSelect"),
  rootUpstreamInput: document.querySelector("#rootUpstreamInput"),
  listenPortInput: document.querySelector("#listenPortInput"),
  mockConfigButton: document.querySelector("#mockConfigButton"),
  routeForm: document.querySelector("#routeForm"),
  routeDomainSelect: document.querySelector("#routeDomainSelect"),
  subdomainInput: document.querySelector("#subdomainInput"),
  targetInput: document.querySelector("#targetInput"),
  routeList: document.querySelector("#routeList"),
  activeDomainSelect: document.querySelector("#activeDomainSelect"),
  selectedDomainTitle: document.querySelector("#selectedDomainTitle"),
  runTestButton: document.querySelector("#runTestButton"),
  requestHostSelect: document.querySelector("#requestHostSelect"),
  autoRequestControl: document.querySelector(".auto-request-control"),
  manualModeButton: document.querySelector("#manualModeButton"),
  autoModeButton: document.querySelector("#autoModeButton"),
  manualRequestForm: document.querySelector("#manualRequestForm"),
  manualDomainInput: document.querySelector("#manualDomainInput"),
  manualSubdomainInput: document.querySelector("#manualSubdomainInput"),
  availableList: document.querySelector("#availableList"),
  enabledList: document.querySelector("#enabledList"),
  toggleConfigButton: document.querySelector("#toggleConfigButton"),
  configPanel: document.querySelector(".config-panel"),
  configPreview: document.querySelector("#configPreview"),
  testOutput: document.querySelector("#testOutput"),
  testBadge: document.querySelector("#testBadge"),
  domainCount: document.querySelector("#domainCount"),
  enabledCount: document.querySelector("#enabledCount"),
  sslCount: document.querySelector("#sslCount"),
  flowNotice: document.querySelector("#flowNotice"),
  routingSvg: document.querySelector("#routingSvg")
};

function createId(value) {
  return value.toLowerCase().replace(/[^a-z0-9.-]/g, "-").replace(/-+/g, "-");
}

function cleanDomain(value) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

function createDomain(name) {
  const domain = cleanDomain(name);
  if (!domain || state.domains.some((item) => item.name === domain)) {
    return null;
  }

  const newDomain = {
    id: createId(domain),
    name: domain,
    listenPort: 80,
    rootUpstream: "http://127.0.0.1:3000",
    ssl: false,
    certSerial: null,
    available: true,
    enabled: false,
    configGenerated: false,
    routes: []
  };

  state.domains.push(newDomain);
  state.activeDomainId = newDomain.id;
  state.activeRequestHost = newDomain.name;
  return newDomain;
}

function getActiveDomain() {
  return state.domains.find((domain) => domain.id === state.activeDomainId) || state.domains[0];
}

function getDomainById(id) {
  return state.domains.find((domain) => domain.id === id);
}

function resetRequestState(domain) {
  state.manualRequest = null;
  if (domain) {
    state.activeRequestHost = domain.name;
    els.manualDomainInput.value = domain.name;
    els.manualSubdomainInput.value = "";
  } else {
    state.activeRequestHost = null;
    els.manualDomainInput.value = "";
    els.manualSubdomainInput.value = "";
  }
}

function setSelectOptions(select, domains) {
  const current = select.value;
  select.innerHTML = domains
    .map((domain) => `<option value="${domain.id}">${domain.name}</option>`)
    .join("");

  if (domains.some((domain) => domain.id === current)) {
    select.value = current;
  } else if (state.activeDomainId) {
    select.value = state.activeDomainId;
  }
}

function getRequestOptions(domain) {
  if (!domain) return [];
  return [
    { host: domain.name, target: domain.rootUpstream, label: `${domain.name} -> root app`, matched: true },
    ...domain.routes.map((route) => ({
      host: route.host,
      target: route.target,
      label: `${route.host} -> ${route.target}`,
      matched: true
    }))
  ];
}

function getActiveRequest(domain) {
  if (state.requestMode === "manual") {
    return getManualRequest(domain);
  }

  const options = getRequestOptions(domain);
  return options.find((option) => option.host === state.activeRequestHost) || options[0];
}

function syncActiveRequest(domain) {
  const options = getRequestOptions(domain);
  if (!options.length) return;
  if (!options.some((option) => option.host === state.activeRequestHost)) {
    state.activeRequestHost = options[0].host;
  }
}

function setRequestOptions(domain) {
  syncActiveRequest(domain);
  const options = getRequestOptions(domain);
  els.requestHostSelect.innerHTML = options
    .map((option) => `<option value="${option.host}">${option.label}</option>`)
    .join("");
  if (state.activeRequestHost) {
    els.requestHostSelect.value = state.activeRequestHost;
  }
}

function buildManualHost(domainName, subdomain) {
  const cleanBase = cleanDomain(domainName);
  const cleanSubdomain = subdomain.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  return cleanSubdomain ? `${cleanSubdomain}.${cleanBase}` : cleanBase;
}

function getManualRequest(domain) {
  if (!state.manualRequest) {
    const previewHost = buildManualHost(els.manualDomainInput.value || domain.name, els.manualSubdomainInput.value || "");
    return {
      host: previewHost,
      target: null,
      label: previewHost,
      matched: false,
      pending: true
    };
  }

  return state.manualRequest;
}

function resolveManualRequest() {
  const domainName = cleanDomain(els.manualDomainInput.value);
  const host = buildManualHost(domainName, els.manualSubdomainInput.value);
  const domain = state.domains.find((item) => item.name === domainName);

  if (!domain) {
    state.manualRequest = {
      host,
      target: null,
      label: host,
      matched: false,
      reason: "domain-missing"
    };
    return null;
  }

  state.activeDomainId = domain.id;
  const match = getRequestOptions(domain).find((option) => option.host === host);
  state.manualRequest = match || {
    host,
    target: null,
    label: host,
    matched: false,
    reason: "server-name-missing"
  };
  return domain;
}

function generateConfig(domain) {
  const routeBlocks = domain.routes.map((route) => {
    return `server {
    listen ${domain.listenPort};
    server_name ${route.host};

    location / {
        proxy_pass ${route.target};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}`;
  });

  const sslLines = domain.ssl
    ? `
    ssl_certificate     /etc/nginx/mock-certs/${domain.name}.crt;
    ssl_certificate_key /etc/nginx/mock-certs/${domain.name}.key;`
    : "";

  return `# generated-sites/${domain.name}.conf
# copied to sites-available/${domain.name}.conf
# sites-available stores configs; it does not receive traffic.
# sites-enabled loads traffic only when a symlink exists.
# current symlink: ${domain.enabled ? `sites-enabled/${domain.name}.conf -> ../sites-available/${domain.name}.conf` : "missing"}

server {
    listen ${domain.listenPort}${domain.ssl ? " ssl" : ""};
    server_name ${domain.name};${sslLines}

    location / {
        proxy_pass ${domain.rootUpstream};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
${routeBlocks.length ? `\n${routeBlocks.join("\n\n")}` : ""}`;
}

function updateConfigPreview() {
  const active = getActiveDomain();
  els.configPreview.textContent = active ? generateConfig(active) : "";
  els.configPanel.classList.toggle("collapsed", !state.showConfig);
}

function setTestOutput(status, text) {
  state.testStatus = status;
  els.testBadge.className = `result-badge ${status}`;
  els.testBadge.textContent = status === "ok" ? "passing" : status === "warn" ? "warning" : "failed";
  els.testOutput.textContent = text;
}

function runMockTest() {
  const domain = getActiveDomain();
  if (!domain) return;

  const missingConfig = !domain.configGenerated;
  const disabled = !domain.enabled;
  const badTarget = [domain.rootUpstream, ...domain.routes.map((route) => route.target)].some(
    (target) => !/^https?:\/\/[^ ]+$/i.test(target)
  );

  if (badTarget) {
    setTestOutput(
      "fail",
      `nginx: [emerg] invalid proxy_pass target in sites-enabled/${domain.name}.conf
nginx: configuration file /etc/nginx/nginx.conf test failed`
    );
    return;
  }

  if (missingConfig || disabled) {
    setTestOutput(
      "warn",
      `nginx: configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
note: ${domain.name} is ${missingConfig ? "not generated" : "not enabled"} in this mock workspace`
    );
    return;
  }

  setTestOutput(
    "ok",
    `nginx: configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
reload: ${domain.name} would be reloaded`
  );
}

function renderSiteRows() {
  els.availableList.innerHTML = "";
  els.enabledList.innerHTML = "";

  state.domains.forEach((domain) => {
    const availableRow = document.createElement("div");
    availableRow.className = "site-row";
    availableRow.innerHTML = `
      <div>
        <div class="site-name">${domain.name}.conf</div>
        <div class="site-meta">${domain.configGenerated ? "stored only; no traffic until enabled" : "waiting for config"}</div>
      </div>
      <button class="tiny-action ${domain.enabled ? "enabled" : ""}" data-action="toggle-enabled" data-id="${domain.id}">
        ${domain.enabled ? "Disable symlink" : "Create symlink"}
      </button>
    `;
    els.availableList.appendChild(availableRow);

    if (domain.enabled) {
      const enabledRow = document.createElement("div");
      enabledRow.className = "site-row";
      enabledRow.innerHTML = `
        <div>
          <div class="site-name">${domain.name}</div>
          <div class="site-meta">active symlink -> ${domain.name}.conf</div>
        </div>
        <button class="tiny-action" data-action="disable" data-id="${domain.id}">
          Disable
        </button>
      `;
      els.enabledList.appendChild(enabledRow);
    }
  });

  if (!els.enabledList.children.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No enabled symlinks. Nginx has no site config to route traffic to.";
    els.enabledList.appendChild(empty);
  }
}

function renderRouteRows(domain) {
  els.routeList.innerHTML = "";

  if (!domain) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Create a domain before adding routes.";
    els.routeList.appendChild(empty);
    return;
  }

  if (!domain.routes.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No subdomain routes yet. The root domain still routes to the root upstream.";
    els.routeList.appendChild(empty);
    return;
  }

  domain.routes.forEach((route) => {
    const row = document.createElement("div");
    row.className = "route-row";
    row.innerHTML = `
      <div>
        <div class="site-name">${route.host}</div>
        <div class="site-meta">proxy_pass ${route.target}</div>
      </div>
      <button class="tiny-action danger" data-action="delete-route" data-domain-id="${domain.id}" data-subdomain="${route.subdomain}">
        Delete
      </button>
    `;
    els.routeList.appendChild(row);
  });
}

function svgEl(name, attributes = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}

function appendText(parent, text, x, y, className = "svg-label") {
  const node = svgEl("text", { x, y, class: className });
  node.textContent = text;
  parent.appendChild(node);
}

function appendNode(parent, x, y, width, height, title, label, status = "active", extraClass = "") {
  parent.appendChild(svgEl("rect", { x, y, width, height, rx: 8, class: `svg-node ${status} ${extraClass}`.trim() }));
  appendText(parent, title, x + 18, y + 32, "svg-title");
  appendText(parent, label, x + 18, y + 58, "svg-label");
}

function appendLine(parent, points, active = true, extraClass = "") {
  const path = svgEl("path", {
    d: `M ${points.map((point) => point.join(" ")).join(" L ")}`,
    class: `route-line ${active ? "" : "disabled"} ${extraClass}`.trim()
  });
  parent.appendChild(path);
  return path;
}

function appendPath(parent, d, active = true, extraClass = "") {
  const path = svgEl("path", {
    d,
    class: `route-line ${active ? "" : "disabled"} ${extraClass}`.trim()
  });
  parent.appendChild(path);
  return path;
}

function stopPacketAnimation() {
  if (state.packetAnimationFrame) {
    cancelAnimationFrame(state.packetAnimationFrame);
    state.packetAnimationFrame = null;
  }
}

function appendPacket(parent, pathD, loop) {
  stopPacketAnimation();
  const motionPath = svgEl("path", { d: pathD, class: "packet-motion-path" });
  const dot = svgEl("circle", { r: 10, class: "request-dot packet" });
  parent.appendChild(motionPath);
  parent.appendChild(dot);
  startPacketAnimation(dot, motionPath, loop);
}

function startPacketAnimation(dot, path, loop) {
  const totalLength = path.getTotalLength();
  const duration = loop ? 3600 : 2600;
  let startedAt = null;

  function tick(timestamp) {
    if (!startedAt) startedAt = timestamp;
    const elapsed = timestamp - startedAt;
    const progress = loop ? (elapsed % duration) / duration : Math.min(elapsed / duration, 1);
    const point = path.getPointAtLength(totalLength * progress);
    dot.setAttribute("transform", `translate(${point.x} ${point.y})`);

    if (loop || progress < 1) {
      state.packetAnimationFrame = requestAnimationFrame(tick);
    } else {
      state.packetAnimationFrame = null;
    }
  }

  state.packetAnimationFrame = requestAnimationFrame(tick);
}

function appendStop(parent, x, y, label) {
  parent.appendChild(svgEl("circle", { cx: x, cy: y, r: 18, class: "stop-marker" }));
  appendText(parent, "!", x - 4, y + 6, "stop-text");
  appendText(parent, label, x - 92, y + 44, "stop-text");
}

function getFlowMessage(domain, request) {
  if (state.requestMode === "manual" && request.pending) {
    return {
      status: "warn",
      text: `Manual mode is ready. Send ${request.host} to see which server block handles it.`
    };
  }

  if (!request.matched) {
    return {
      status: "warn",
      text:
        request.reason === "domain-missing"
          ? `${request.host} does not exist in this mock domain registry.`
          : `${request.host} does not match any server_name in ${domain.name}.conf.`
    };
  }

  if (!domain.configGenerated) {
    return {
      status: "warn",
      text: `${request.host} can reach Nginx, but ${domain.name} has no generated site file yet.`
    };
  }

  if (!domain.enabled) {
    return {
      status: "warn",
      text: `${request.host} is only in sites-available. Because no sites-enabled symlink exists, the request stops at Nginx.`
    };
  }

  return {
    status: "ok",
    text: `${request.host} matches an enabled server block and proxies to ${request.target}.`
  };
}

function renderWhiteboard() {
  const domain = getActiveDomain();
  stopPacketAnimation();
  els.routingSvg.innerHTML = "";
  if (!domain) return;

  syncActiveRequest(domain);
  const request = getActiveRequest(domain);
  const active = domain.enabled && domain.configGenerated && request.matched;
  const flow = getFlowMessage(domain, request);
  const protocol = domain.ssl ? "HTTPS" : "HTTP";
  const hostLabel = domain.ssl ? `${domain.name} :443` : `${domain.name} :${domain.listenPort}`;

  els.flowNotice.className = `flow-notice ${flow.status}`;
  els.flowNotice.textContent = flow.text;

  renderNetworkMap(els.routingSvg, domain, request, active, protocol, hostLabel);
}

function appendNetworkNode(parent, x, y, width, height, title, label, status = "active", extraClass = "") {
  const group = svgEl("g", { class: `network-node ${status} ${extraClass}`.trim() });
  group.appendChild(svgEl("rect", { x, y, width, height, rx: 16, class: "network-node-body" }));
  group.appendChild(svgEl("circle", { cx: x + 28, cy: y + 28, r: 9, class: "network-led" }));
  appendText(group, title, x + 50, y + 30, "network-title");
  appendText(group, label, x + 50, y + 54, "network-label");
  parent.appendChild(group);
}

function appendServiceNode(parent, service, isActive, isReachable) {
  const status = isActive && isReachable ? "ok" : isReachable ? "idle" : "warn";
  const group = svgEl("g", { class: `service-node ${status}` });
  group.appendChild(svgEl("rect", { x: service.x, y: service.y, width: 250, height: 74, rx: 14, class: "service-body" }));
  group.appendChild(svgEl("rect", { x: service.x + 14, y: service.y + 18, width: 50, height: 38, rx: 6, class: "port-chip" }));
  appendText(group, service.port, service.x + 22, service.y + 43, "port-text");
  appendText(group, service.host, service.x + 76, service.y + 30, "network-title");
  appendText(group, service.target, service.x + 76, service.y + 54, "network-label");
  parent.appendChild(group);
}

function getPort(target) {
  const match = target.match(/:(\d+)(?:\/|$)/);
  return match ? match[1] : target.startsWith("https://") ? "443" : "80";
}

function renderNetworkMap(svg, domain, request, active, protocol, hostLabel) {
  const hasSentManualRequest = state.requestMode === "automatic" || !request.pending;
  svg.appendChild(svgEl("defs")).innerHTML = `
    <pattern id="networkGrid" width="42" height="42" patternUnits="userSpaceOnUse">
      <path d="M 42 0 L 0 0 0 42" class="grid-path"></path>
    </pattern>
    <filter id="softGlow">
      <feGaussianBlur stdDeviation="5" result="blur"></feGaussianBlur>
      <feMerge>
        <feMergeNode in="blur"></feMergeNode>
        <feMergeNode in="SourceGraphic"></feMergeNode>
      </feMerge>
    </filter>
  `;
  svg.appendChild(svgEl("rect", { x: 0, y: 0, width: 1180, height: 680, class: "network-bg" }));
  svg.appendChild(svgEl("rect", { x: 0, y: 0, width: 1180, height: 680, fill: "url(#networkGrid)", class: "network-grid" }));

  appendText(svg, state.requestMode === "manual" ? "manual request" : "request packet", 56, 54, "map-section-title");
  appendText(svg, `${request.host} over ${protocol}`, 56, 78, "map-section-label");
  appendText(svg, "server boundary", 390, 54, "map-section-title");
  appendText(svg, "Nginx reads enabled symlinks, then chooses a server block", 390, 78, "map-section-label");
  appendText(svg, "upstream ports", 850, 54, "map-section-title");
  appendText(svg, "selected host chooses service", 850, 78, "map-section-label");

  svg.appendChild(svgEl("rect", { x: 378, y: 98, width: 420, height: 500, rx: 22, class: "server-zone" }));
  appendText(svg, "/etc/nginx", 408, 132, "zone-title");

  appendNetworkNode(svg, 54, 142, 220, 82, "Browser", request.host, "active");
  appendNetworkNode(svg, 54, 304, 220, 82, "DNS", hostLabel, domain.ssl ? "ok" : "warn");
  appendNetworkNode(svg, 404, 178, 270, 86, "Nginx Gateway", "listens, matches server_name", active ? "ok" : "warn", "gateway");
  appendNetworkNode(svg, 438, 326, 242, 82, "sites-available", domain.configGenerated ? `${domain.name}.conf stored` : "no config file", domain.configGenerated ? "idle" : "warn");
  appendNetworkNode(svg, 438, 470, 242, 82, "sites-enabled", domain.enabled ? "symlink active" : "missing symlink", domain.enabled ? "ok" : "warn");

  if (domain.ssl) {
    appendNetworkNode(svg, 404, 596, 270, 58, "Mock SSL Cert", domain.certSerial, "ok", "cert-node");
  }

  const services = getRequestOptions(domain).slice(0, 5).map((option, index) => ({
    ...option,
    x: 850,
    y: 138 + index * 96,
    port: getPort(option.target)
  }));

  const selectedService = services.find((service) => service.host === request.host);
  services.forEach((service) => {
    const isActiveService = service.host === request.host;
    appendServiceNode(svg, service, isActiveService, active);
    const routeD = `M 680 ${511} C 740 ${511}, 780 ${service.y + 37}, 850 ${service.y + 37}`;
    appendPath(svg, routeD, active && isActiveService, isActiveService ? "selected-route" : "ghost-route");
  });

  const ingressPath = "M 274 183 C 326 183, 340 222, 404 222";
  const dnsPath = "M 164 224 C 164 248, 164 276, 164 304";
  const serverPath = "M 539 264 C 539 286, 539 305, 539 326";
  const symlinkPath = "M 559 408 C 559 434, 559 445, 559 470";
  const activePath = active && selectedService
    ? `M 92 183 C 132 183, 214 183, 274 183 C 326 183, 340 222, 404 222 C 462 222, 530 248, 539 326 C 548 397, 559 430, 559 470 C 650 511, 755 511, 850 ${selectedService.y + 37}`
    : "M 92 183 C 132 183, 214 183, 274 183 C 326 183, 340 222, 404 222";

  appendPath(svg, dnsPath, hasSentManualRequest, "soft-route");
  appendPath(svg, ingressPath, hasSentManualRequest, "selected-route");
  appendPath(svg, serverPath, hasSentManualRequest && domain.configGenerated && request.matched, "selected-route");
  appendPath(svg, symlinkPath, hasSentManualRequest && active, "selected-route");

  if (active && selectedService) {
    appendPacket(svg, activePath, state.requestMode === "automatic");
    appendText(svg, `matched: ${request.host}`, 704, 476, "route-caption");
    appendText(svg, `proxy_pass ${request.target}`, 704, 504, "route-caption strong");
  } else if (hasSentManualRequest) {
    svg.appendChild(svgEl("circle", { cx: 404, cy: 222, r: 9, class: "request-dot paused" }));
    appendStop(svg, 716, 511, request.matched ? "stopped before upstream" : "no matching server_name");
  }
}

function render() {
  const active = getActiveDomain();
  const domains = state.domains;

  [els.sslDomainSelect, els.configDomainSelect, els.routeDomainSelect, els.activeDomainSelect].forEach((select) =>
    setSelectOptions(select, domains)
  );

  if (active) {
    syncActiveRequest(active);
    els.activeDomainSelect.value = active.id;
    els.configDomainSelect.value = active.id;
    els.routeDomainSelect.value = active.id;
    els.sslDomainSelect.value = active.id;
    setRequestOptions(active);
    if (!els.manualDomainInput.value) {
      els.manualDomainInput.value = active.name;
    }
    els.selectedDomainTitle.textContent = active.name;
    els.rootUpstreamInput.value = active.rootUpstream;
    els.listenPortInput.value = active.listenPort;
  } else {
    els.requestHostSelect.innerHTML = "";
    els.selectedDomainTitle.textContent = "No domain selected";
    els.configPreview.textContent = "";
    els.flowNotice.className = "flow-notice warn";
    els.flowNotice.textContent = "Create a domain to start routing mock requests.";
  }

  els.domainCount.textContent = `${domains.length} ${domains.length === 1 ? "domain" : "domains"}`;
  els.enabledCount.textContent = `${domains.filter((domain) => domain.enabled).length} enabled`;
  els.sslCount.textContent = `${domains.filter((domain) => domain.ssl).length} SSL`;
  els.manualModeButton.classList.toggle("active", state.requestMode === "manual");
  els.autoModeButton.classList.toggle("active", state.requestMode === "automatic");
  els.manualRequestForm.hidden = state.requestMode !== "manual";
  els.autoRequestControl.hidden = state.requestMode !== "automatic";
  els.deleteDomainButton.disabled = !active;
  els.issueSslButton.disabled = !active;
  els.mockConfigButton.disabled = !active;

  renderSiteRows();
  renderRouteRows(active);
  updateConfigPreview();
  renderWhiteboard();
}

els.domainForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const domain = createDomain(els.domainInput.value);
  if (domain) {
    resetRequestState(domain);
    setTestOutput("warn", `${domain.name} created in the mock domain registry`);
  }
  render();
});

els.deleteDomainButton.addEventListener("click", () => {
  const domain = getActiveDomain();
  if (!domain) return;

  const deletedName = domain.name;
  const deletedIndex = state.domains.findIndex((item) => item.id === domain.id);
  state.domains = state.domains.filter((item) => item.id !== domain.id);

  const nextDomain = state.domains[deletedIndex] || state.domains[deletedIndex - 1] || state.domains[0] || null;
  state.activeDomainId = nextDomain ? nextDomain.id : null;
  resetRequestState(nextDomain);
  setTestOutput("warn", `${deletedName} deleted from the mock domain registry`);
  render();
});

els.issueSslButton.addEventListener("click", () => {
  const domain = getDomainById(els.sslDomainSelect.value);
  if (!domain) return;
  state.activeDomainId = domain.id;
  domain.ssl = true;
  domain.certSerial = `MOCK-${Math.random().toString(16).slice(2, 10).toUpperCase()}`;
  setTestOutput("ok", `mock certificate issued for ${domain.name}\nserial: ${domain.certSerial}`);
  render();
});

els.configForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const domain = getDomainById(els.configDomainSelect.value);
  if (!domain) return;
  state.activeDomainId = domain.id;
  domain.rootUpstream = els.rootUpstreamInput.value.trim();
  domain.listenPort = Number(els.listenPortInput.value);
  domain.configGenerated = true;
  domain.available = true;
  setTestOutput("ok", `generated-sites/${domain.name}.conf\ncopied to sites-available/${domain.name}.conf`);
  render();
});

els.mockConfigButton.addEventListener("click", () => {
  const domain = getDomainById(els.configDomainSelect.value);
  if (!domain) return;
  state.activeDomainId = domain.id;
  domain.rootUpstream = "http://127.0.0.1:3000";
  domain.listenPort = domain.ssl ? 443 : 80;
  domain.configGenerated = true;
  domain.available = true;
  if (!domain.routes.length) {
    domain.routes.push({ subdomain: "api", host: `api.${domain.name}`, target: "http://127.0.0.1:8000" });
    domain.routes.push({ subdomain: "admin", host: `admin.${domain.name}`, target: "http://127.0.0.1:5173" });
  }
  setTestOutput("ok", `mock config generated for ${domain.name}`);
  render();
});

els.routeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const domain = getDomainById(els.routeDomainSelect.value);
  if (!domain) return;
  state.activeDomainId = domain.id;
  const subdomain = els.subdomainInput.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!subdomain) return;
  const existing = domain.routes.find((route) => route.subdomain === subdomain);
  const route = { subdomain, host: `${subdomain}.${domain.name}`, target: els.targetInput.value.trim() };

  if (existing) {
    existing.target = route.target;
  } else {
    domain.routes.push(route);
  }

  domain.configGenerated = true;
  state.activeRequestHost = route.host;
  setTestOutput("ok", `${route.host} routed to ${route.target}`);
  render();
});

els.routeList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action='delete-route']");
  if (!button) return;

  const domain = getDomainById(button.dataset.domainId);
  if (!domain) return;

  const route = domain.routes.find((item) => item.subdomain === button.dataset.subdomain);
  if (!route) return;

  domain.routes = domain.routes.filter((item) => item.subdomain !== button.dataset.subdomain);
  state.activeDomainId = domain.id;
  resetRequestState(domain);
  setTestOutput("warn", `${route.host} deleted from ${domain.name}.conf`);
  render();
});

els.availableList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action='toggle-enabled']");
  if (!button) return;
  const domain = getDomainById(button.dataset.id);
  if (!domain) return;
  domain.enabled = !domain.enabled;
  domain.configGenerated = domain.configGenerated || domain.enabled;
  state.activeDomainId = domain.id;
  runMockTest();
  render();
});

els.enabledList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action='disable']");
  if (!button) return;
  const domain = getDomainById(button.dataset.id);
  if (!domain) return;
  domain.enabled = false;
  state.activeDomainId = domain.id;
  runMockTest();
  render();
});

els.activeDomainSelect.addEventListener("change", (event) => {
  state.activeDomainId = event.target.value;
  const domain = getDomainById(event.target.value);
  syncActiveRequest(domain);
  state.manualRequest = null;
  if (domain) {
    els.manualDomainInput.value = domain.name;
  }
  render();
});

els.requestHostSelect.addEventListener("change", (event) => {
  state.activeRequestHost = event.target.value;
  render();
});

els.manualModeButton.addEventListener("click", () => {
  state.requestMode = "manual";
  state.manualRequest = null;
  const domain = getActiveDomain();
  if (domain && !els.manualDomainInput.value) {
    els.manualDomainInput.value = domain.name;
  }
  render();
});

els.autoModeButton.addEventListener("click", () => {
  state.requestMode = "automatic";
  state.manualRequest = null;
  render();
});

els.manualRequestForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.requestMode = "manual";
  const domain = resolveManualRequest();
  if (domain) {
    setTestOutput(
      state.manualRequest.matched ? "ok" : "warn",
      state.manualRequest.matched
        ? `request: ${state.manualRequest.host}\nmatched server_name: ${state.manualRequest.host}\nproxy_pass: ${state.manualRequest.target}`
        : `request: ${state.manualRequest.host}\nno matching server_name found in ${domain.name}.conf`
    );
  } else {
    setTestOutput("warn", `request: ${state.manualRequest.host}\nmock domain was not found`);
  }
  render();
});

els.runTestButton.addEventListener("click", () => {
  runMockTest();
  render();
});

els.toggleConfigButton.addEventListener("click", () => {
  state.showConfig = !state.showConfig;
  render();
});

createDomain("demo.local");
const demo = getActiveDomain();
demo.ssl = true;
demo.certSerial = "MOCK-8F21AC90";
demo.configGenerated = true;
demo.enabled = true;
demo.routes.push({ subdomain: "api", host: "api.demo.local", target: "http://127.0.0.1:8000" });
demo.routes.push({ subdomain: "admin", host: "admin.demo.local", target: "http://127.0.0.1:5173" });
setTestOutput(
  "ok",
  `nginx: configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
reload: demo.local would be reloaded`
);
render();
