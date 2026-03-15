/**
 * Dashboard HTML generator — produces a self-contained, dark-themed
 * single-page HTML dashboard for claude-test analysis results.
 */

export interface DashboardData {
  projectName: string;
  projectPath: string;
  generatedAt: string;
  context: {
    totalFiles: number;
    textFiles: number;
    totalBytes: number;
    estimatedTokens: number;
    extensionBreakdown: Array<{
      extension: string;
      fileCount: number;
      estimatedTokens: number;
    }>;
    largestFiles: Array<{ path: string; estimatedTokens: number }>;
    fitEstimates: Array<{
      windowLabel: string;
      fits: boolean;
      utilization: number;
      headroom: number;
    }>;
  };
  assets: Array<{
    path: string;
    type: string;
    confidence: string;
    reason: string;
  }>;
  models: Array<{
    id: string;
    provider: string;
    name: string;
    contextWindow: number;
    inputPricePer1M: number;
    outputPricePer1M: number;
  }>;
  doctor: Array<{ name: string; status: string; message: string }>;
  workflow: {
    score: number;
    maxScore: number;
    detected: string[];
    missing: string[];
  };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatTokens(tokens: number): string {
  if (tokens < 1000) return tokens.toString();
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${(tokens / 1_000_000).toFixed(2)}M`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function providerColor(provider: string): string {
  const colors: Record<string, string> = {
    anthropic: '#d97706',
    openai: '#10b981',
    google: '#3b82f6',
    deepseek: '#8b5cf6',
    qwen: '#ec4899',
    meta: '#06b6d4',
    mistral: '#f97316',
    local: '#6b7280',
  };
  return colors[provider] ?? '#9ca3af';
}

function assetTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    'claude-config': 'Claude Code',
    'cursor-config': 'Cursor',
    'windsurf-config': 'Windsurf',
    'copilot-config': 'GitHub Copilot',
    'aider-config': 'Aider',
    'continue-config': 'Continue.dev',
    'cline-config': 'Cline',
    'codex-config': 'OpenAI Codex',
    agent: 'Agent',
    skill: 'Skill',
    hook: 'Hook',
    'mcp-config': 'MCP Config',
    'prompt-spec': 'Prompt Spec',
    'context-file': 'Context File',
    'agentic-workflow': 'Agentic Workflow',
  };
  return labels[type] ?? type;
}

export function generateDashboard(data: DashboardData): string {
  const doctorPassCount = data.doctor.filter(
    (d) => d.status === 'pass',
  ).length;
  const doctorTotal = data.doctor.length;

  const topFiles = data.context.largestFiles.slice(0, 15);
  const maxFileTokens = topFiles[0]?.estimatedTokens ?? 1;

  // Group assets by type
  const assetsByType = new Map<string, typeof data.assets>();
  for (const asset of data.assets) {
    const group = assetsByType.get(asset.type) ?? [];
    group.push(asset);
    assetsByType.set(asset.type, group);
  }

  // Build HTML sections
  const overviewCards = `
    <div class="overview-grid">
      <div class="card stat-card">
        <div class="stat-value">${formatNumber(data.context.totalFiles)}</div>
        <div class="stat-label">Total Files</div>
        <div class="stat-sub">${formatNumber(data.context.textFiles)} text files</div>
      </div>
      <div class="card stat-card">
        <div class="stat-value">${formatTokens(data.context.estimatedTokens)}</div>
        <div class="stat-label">Estimated Tokens</div>
        <div class="stat-sub">${formatBytes(data.context.totalBytes)}</div>
      </div>
      <div class="card stat-card">
        <div class="stat-value">${data.assets.length}</div>
        <div class="stat-label">AI Tools Found</div>
        <div class="stat-sub">${assetsByType.size} tool type${assetsByType.size !== 1 ? 's' : ''}</div>
      </div>
      <div class="card stat-card">
        <div class="stat-value">${doctorPassCount}/${doctorTotal}</div>
        <div class="stat-label">Doctor Checks</div>
        <div class="stat-sub ${doctorPassCount === doctorTotal ? 'pass' : 'warn'}">
          ${doctorPassCount === doctorTotal ? 'All passed' : `${doctorTotal - doctorPassCount} issue${doctorTotal - doctorPassCount !== 1 ? 's' : ''}`}
        </div>
      </div>
    </div>
  `;

  const fitBars = data.context.fitEstimates
    .map((fit) => {
      const pct = Math.min(fit.utilization * 100, 100);
      const colorClass = fit.fits ? 'bar-green' : 'bar-red';
      const headroomText =
        fit.headroom >= 0
          ? `${formatTokens(fit.headroom)} headroom`
          : `${formatTokens(Math.abs(fit.headroom))} over`;
      return `
      <div class="fit-row">
        <div class="fit-label">${escapeHtml(fit.windowLabel)} window</div>
        <div class="fit-bar-container">
          <div class="fit-bar ${colorClass}" style="width: ${pct.toFixed(1)}%"></div>
        </div>
        <div class="fit-stats">
          <span class="${fit.fits ? 'pass' : 'fail'}">${fit.fits ? 'FITS' : 'OVER'}</span>
          <span class="dim">${(pct).toFixed(1)}% &middot; ${headroomText}</span>
        </div>
      </div>`;
    })
    .join('\n');

  const heatmapRows = topFiles
    .map((file) => {
      const pct = maxFileTokens > 0 ? (file.estimatedTokens / maxFileTokens) * 100 : 0;
      const ratio = file.estimatedTokens / maxFileTokens;
      const barColor =
        ratio > 0.7 ? '#f87171' : ratio > 0.3 ? '#fbbf24' : '#4ade80';
      const truncatedPath =
        file.path.length > 55
          ? '...' + file.path.slice(file.path.length - 52)
          : file.path;
      return `
      <div class="heatmap-row">
        <div class="heatmap-path" title="${escapeHtml(file.path)}">${escapeHtml(truncatedPath)}</div>
        <div class="heatmap-bar-container">
          <div class="heatmap-bar" style="width: ${pct.toFixed(1)}%; background: ${barColor};"></div>
        </div>
        <div class="heatmap-tokens">${formatTokens(file.estimatedTokens)}</div>
      </div>`;
    })
    .join('\n');

  const extensionRows = data.context.extensionBreakdown
    .slice(0, 20)
    .map(
      (ext) => `
      <tr>
        <td><code>${escapeHtml(ext.extension)}</code></td>
        <td class="num">${ext.fileCount}</td>
        <td class="num">${formatTokens(ext.estimatedTokens)}</td>
      </tr>`,
    )
    .join('\n');

  const assetCards = Array.from(assetsByType.entries())
    .map(([type, assets]) => {
      const items = assets
        .map(
          (a) => `
        <div class="asset-item">
          <div class="asset-path">${escapeHtml(a.path)}</div>
          <div class="asset-meta">
            <span class="badge badge-${a.confidence}">${a.confidence}</span>
            <span class="dim">${escapeHtml(a.reason)}</span>
          </div>
        </div>`,
        )
        .join('\n');
      return `
      <div class="card asset-group">
        <h3>${escapeHtml(assetTypeLabel(type))}</h3>
        ${items}
      </div>`;
    })
    .join('\n');

  const modelRows = data.models
    .map((m) => {
      const color = providerColor(m.provider);
      return `
      <tr>
        <td><span class="provider-dot" style="background: ${color};"></span>${escapeHtml(m.provider)}</td>
        <td>${escapeHtml(m.name)}</td>
        <td class="num">${formatTokens(m.contextWindow)}</td>
        <td class="num">$${m.inputPricePer1M.toFixed(2)}</td>
        <td class="num">$${m.outputPricePer1M.toFixed(2)}</td>
      </tr>`;
    })
    .join('\n');

  const doctorRows = data.doctor
    .map((check) => {
      const icon =
        check.status === 'pass'
          ? '<span class="status-icon pass">&#10003;</span>'
          : check.status === 'warn'
            ? '<span class="status-icon warn">&#9888;</span>'
            : '<span class="status-icon fail">&#10007;</span>';
      return `
      <div class="doctor-row">
        ${icon}
        <div class="doctor-info">
          <div class="doctor-name">${escapeHtml(check.name)}</div>
          <div class="doctor-message dim">${escapeHtml(check.message)}</div>
        </div>
      </div>`;
    })
    .join('\n');

  const workflowSection = `
    <div class="workflow-score">
      <div class="score-ring">
        <span class="score-number ${data.workflow.score >= 4 ? 'pass' : data.workflow.score >= 2 ? 'warn' : 'fail'}">${data.workflow.score}</span>
        <span class="score-max">/ ${data.workflow.maxScore}</span>
      </div>
      <div class="workflow-details">
        ${
          data.workflow.detected.length > 0
            ? `<div class="workflow-list"><span class="label pass">Detected:</span> ${data.workflow.detected.map((d) => `<span class="badge badge-high">${escapeHtml(d)}</span>`).join(' ')}</div>`
            : ''
        }
        ${
          data.workflow.missing.length > 0
            ? `<div class="workflow-list"><span class="label warn">Missing:</span> ${data.workflow.missing.map((m) => `<span class="badge badge-low">${escapeHtml(m)}</span>`).join(' ')}</div>`
            : ''
        }
      </div>
    </div>
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>claude-test dashboard &mdash; ${escapeHtml(data.projectName)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: #0f0f1a;
    color: #e0e0e0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    line-height: 1.6;
    padding: 0;
  }

  .container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 24px 32px 64px;
  }

  /* Header */
  .header {
    border-bottom: 1px solid #1e293b;
    padding: 32px 0 24px;
    margin-bottom: 32px;
  }
  .header h1 {
    font-size: 28px;
    font-weight: 700;
    color: #f8fafc;
    letter-spacing: -0.5px;
  }
  .header h1 span { color: #818cf8; }
  .header-meta {
    display: flex;
    gap: 24px;
    margin-top: 8px;
    font-size: 13px;
    color: #94a3b8;
  }
  .header-meta code {
    background: #1e293b;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 12px;
    color: #cbd5e1;
  }

  /* Cards */
  .card {
    background: #16213e;
    border: 1px solid #1e3a5f;
    border-radius: 12px;
    padding: 24px;
  }

  .section-title {
    font-size: 18px;
    font-weight: 600;
    color: #f1f5f9;
    margin-bottom: 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid #1e293b;
  }

  /* Overview grid */
  .overview-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
    margin-bottom: 32px;
  }
  @media (max-width: 768px) {
    .overview-grid { grid-template-columns: repeat(2, 1fr); }
  }
  .stat-card {
    text-align: center;
    padding: 28px 16px;
  }
  .stat-value {
    font-size: 36px;
    font-weight: 700;
    color: #f8fafc;
    line-height: 1.1;
  }
  .stat-label {
    font-size: 13px;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-top: 6px;
  }
  .stat-sub {
    font-size: 12px;
    color: #64748b;
    margin-top: 4px;
  }

  /* Two-column layout */
  .two-col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    margin-bottom: 32px;
  }
  @media (max-width: 900px) {
    .two-col { grid-template-columns: 1fr; }
  }

  .full-width {
    margin-bottom: 32px;
  }

  /* Context window fit */
  .fit-row {
    margin-bottom: 16px;
  }
  .fit-label {
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 6px;
    color: #cbd5e1;
  }
  .fit-bar-container {
    height: 24px;
    background: #1e293b;
    border-radius: 6px;
    overflow: hidden;
    margin-bottom: 4px;
  }
  .fit-bar {
    height: 100%;
    border-radius: 6px;
    transition: width 0.5s ease;
  }
  .bar-green { background: linear-gradient(90deg, #22c55e, #4ade80); }
  .bar-red { background: linear-gradient(90deg, #ef4444, #f87171); }
  .fit-stats {
    display: flex;
    gap: 12px;
    font-size: 13px;
    align-items: center;
  }

  /* Heatmap */
  .heatmap-row {
    display: grid;
    grid-template-columns: minmax(150px, 280px) 1fr 70px;
    gap: 12px;
    align-items: center;
    padding: 5px 0;
    border-bottom: 1px solid #1e293b22;
  }
  .heatmap-path {
    font-size: 12px;
    font-family: 'SF Mono', SFMono-Regular, ui-monospace, Menlo, monospace;
    color: #94a3b8;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .heatmap-bar-container {
    height: 16px;
    background: #1e293b;
    border-radius: 4px;
    overflow: hidden;
  }
  .heatmap-bar {
    height: 100%;
    border-radius: 4px;
    min-width: 2px;
  }
  .heatmap-tokens {
    font-size: 12px;
    font-family: 'SF Mono', SFMono-Regular, ui-monospace, Menlo, monospace;
    text-align: right;
    color: #cbd5e1;
  }

  /* Tables */
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  th {
    text-align: left;
    padding: 8px 12px;
    border-bottom: 2px solid #1e293b;
    color: #94a3b8;
    font-weight: 600;
    text-transform: uppercase;
    font-size: 11px;
    letter-spacing: 0.5px;
  }
  td {
    padding: 8px 12px;
    border-bottom: 1px solid #1e293b44;
    color: #cbd5e1;
  }
  td code {
    background: #1e293b;
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 12px;
    color: #e2e8f0;
  }
  .num { text-align: right; font-variant-numeric: tabular-nums; }

  /* Provider dot */
  .provider-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 8px;
    vertical-align: middle;
  }

  /* Assets */
  .asset-group h3 {
    font-size: 15px;
    font-weight: 600;
    color: #e2e8f0;
    margin-bottom: 12px;
  }
  .asset-item {
    padding: 8px 0;
    border-bottom: 1px solid #1e293b44;
  }
  .asset-item:last-child { border-bottom: none; }
  .asset-path {
    font-size: 12px;
    font-family: 'SF Mono', SFMono-Regular, ui-monospace, Menlo, monospace;
    color: #818cf8;
    word-break: break-all;
  }
  .asset-meta {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: 4px;
    font-size: 12px;
  }

  /* Doctor */
  .doctor-row {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding: 10px 0;
    border-bottom: 1px solid #1e293b44;
  }
  .doctor-row:last-child { border-bottom: none; }
  .status-icon {
    font-size: 16px;
    flex-shrink: 0;
    width: 24px;
    text-align: center;
    line-height: 1.4;
  }
  .doctor-name {
    font-size: 14px;
    font-weight: 500;
    color: #e2e8f0;
  }
  .doctor-message {
    font-size: 12px;
    margin-top: 2px;
  }

  /* Workflow */
  .workflow-score {
    display: flex;
    gap: 32px;
    align-items: center;
  }
  .score-ring {
    display: flex;
    align-items: baseline;
    gap: 4px;
  }
  .score-number {
    font-size: 56px;
    font-weight: 800;
    line-height: 1;
  }
  .score-max {
    font-size: 20px;
    color: #64748b;
  }
  .workflow-details {
    flex: 1;
  }
  .workflow-list {
    margin-bottom: 8px;
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }

  /* Badges */
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .badge-high { background: #166534; color: #4ade80; }
  .badge-medium { background: #854d0e; color: #fbbf24; }
  .badge-low { background: #7f1d1d; color: #fca5a5; }

  /* Utility classes */
  .pass { color: #4ade80; }
  .warn { color: #fbbf24; }
  .fail { color: #f87171; }
  .dim { color: #64748b; }
  .label { font-weight: 600; font-size: 13px; }

  /* Footer */
  .footer {
    text-align: center;
    padding: 32px 0;
    font-size: 12px;
    color: #475569;
    border-top: 1px solid #1e293b;
  }
  .footer a { color: #818cf8; text-decoration: none; }
  .footer a:hover { text-decoration: underline; }

  /* Smooth scroll and selection */
  ::selection { background: #818cf855; }
  html { scroll-behavior: smooth; }
</style>
</head>
<body>
<div class="container">

  <!-- Header -->
  <div class="header">
    <h1><span>claude-test</span> dashboard</h1>
    <div class="header-meta">
      <span>Project: <strong>${escapeHtml(data.projectName)}</strong></span>
      <span>Path: <code>${escapeHtml(data.projectPath)}</code></span>
      <span>Generated: ${escapeHtml(data.generatedAt)}</span>
    </div>
  </div>

  <!-- Overview Cards -->
  ${overviewCards}

  <!-- Context Window Fit + Workflow Score -->
  <div class="two-col">
    <div class="card">
      <div class="section-title">Context Window Fit</div>
      ${fitBars}
    </div>
    <div class="card">
      <div class="section-title">Workflow Score</div>
      ${workflowSection}
    </div>
  </div>

  <!-- Token Heatmap -->
  <div class="card full-width">
    <div class="section-title">Token Heatmap &mdash; Top ${topFiles.length} Files</div>
    ${heatmapRows || '<div class="dim">No files found.</div>'}
  </div>

  <!-- Extension Breakdown + Doctor Checks -->
  <div class="two-col">
    <div class="card">
      <div class="section-title">Extension Breakdown</div>
      <table>
        <thead><tr><th>Extension</th><th class="num">Files</th><th class="num">Tokens</th></tr></thead>
        <tbody>${extensionRows}</tbody>
      </table>
    </div>
    <div class="card">
      <div class="section-title">Doctor Checks</div>
      ${doctorRows}
    </div>
  </div>

  <!-- AI Tools Detected -->
  ${
    data.assets.length > 0
      ? `
  <div class="full-width">
    <div class="section-title" style="margin-bottom: 16px;">AI Tools Detected</div>
    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px;">
      ${assetCards}
    </div>
  </div>`
      : ''
  }

  <!-- Models Available -->
  <div class="card full-width">
    <div class="section-title">Models Available</div>
    <div style="overflow-x: auto;">
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Model</th>
            <th class="num">Context</th>
            <th class="num">Input $/1M</th>
            <th class="num">Output $/1M</th>
          </tr>
        </thead>
        <tbody>${modelRows}</tbody>
      </table>
    </div>
  </div>

  <!-- Footer -->
  <div class="footer">
    Generated by <a href="https://github.com/anthropics/claude-test">claude-test</a> &mdash; DevTools for AI Coding
  </div>

</div>
</body>
</html>`;
}
