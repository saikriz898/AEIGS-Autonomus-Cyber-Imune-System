'use client';
import { useId, useMemo, useState } from 'react';
import { Cloud, Database, Laptop, Network, Server, Maximize2, Minus, Plus } from 'lucide-react';
import type { Row } from '../lib/api';

export default function GraphCanvas({
  assets,
  relationships,
  onAsset,
  large = false,
}: {
  assets: Row[];
  relationships: Row[];
  onAsset: (asset: Row) => void;
  large?: boolean;
}) {
  const [zoom, setZoom] = useState(1);
  const [layer, setLayer] = useState(false);
  const marker = `graph-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const visible = useMemo(() => assets.slice(0, 150), [assets]);
  const byId = useMemo(
    () => new Map(visible.map((asset, index) => [asset.id, { asset, index }])),
    [visible],
  );
  const edges = useMemo(
    () =>
      relationships.filter(
        (edge) =>
          byId.has(edge.source_id || edge.source_asset_id || edge.source) &&
          byId.has(edge.target_id || edge.target_asset_id || edge.target),
      ),
    [relationships, byId],
  );
  const icons: Record<string, typeof Server> = {
    gateway: Network,
    server: Server,
    database: Database,
    endpoint: Laptop,
    cloud: Cloud,
  };
  function point(asset: Row, index: number) {
    const columns = Math.max(2, Math.ceil(Math.sqrt(visible.length)));
    const count = Math.max(2, Math.ceil(visible.length / columns));
    const x = Number.isFinite(asset.x) ? asset.x : 10 + ((index % columns) / (columns - 1)) * 80;
    const y = Number.isFinite(asset.y)
      ? asset.y
      : 10 + (Math.floor(index / columns) / (count - 1)) * 80;
    return { x: Math.max(6, Math.min(94, x)), y: Math.max(8, Math.min(92, y)) };
  }
  return (
    <div className={`topology ${large ? 'large' : ''}`}>
      {assets.length > visible.length && (
        <div className="notice">
          Showing {visible.length} of {assets.length} stored assets to keep this graph responsive.
          Use Asset Inventory to locate other records.
        </div>
      )}
      <div className="graph-toolbar">
        <div>
          <button
            className={!layer ? 'active' : ''}
            aria-pressed={!layer}
            onClick={() => setLayer(false)}
          >
            Topology
          </button>
          <button
            className={layer ? 'active' : ''}
            aria-pressed={layer}
            onClick={() => setLayer(true)}
          >
            Risk context
          </button>
        </div>
        <span>
          <i className="status-dot" />
          Stored Digital Twin
        </span>
      </div>
      <div className="graph-canvas">
        <div className="graph-transform" style={{ transform: `scale(${zoom})` }}>
          <svg
            className="graph-lines"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-label="Stored directed relationships"
          >
            <defs>
              <marker id={marker} markerWidth="4" markerHeight="4" refX="5" refY="2" orient="auto">
                <path d="M0 0 4 2 0 4" fill="none" stroke="#779c74" strokeWidth=".7" />
              </marker>
            </defs>
            {edges.map((edge) => {
              const source = byId.get(edge.source_id || edge.source_asset_id || edge.source)!;
              const target = byId.get(edge.target_id || edge.target_asset_id || edge.target)!;
              const a = point(source.asset, source.index),
                b = point(target.asset, target.index);
              return (
                <line
                  key={edge.id}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  className={edge.kind || 'observed'}
                  markerEnd={`url(#${marker})`}
                >
                  <title>
                    {source.asset.name} → {target.asset.name}: {edge.label} ({edge.kind})
                  </title>
                </line>
              );
            })}
          </svg>
          {visible.map((asset, index) => {
            const p = point(asset, index);
            const kind = String(
              asset.asset_type || asset.type || asset.kind || 'server',
            ).toLowerCase();
            const Icon = icons[kind] || Server;
            const score = typeof asset.risk_score === 'number' ? asset.risk_score : undefined;
            const level =
              score === undefined
                ? String(asset.criticality || '').toLowerCase()
                : score >= 75
                  ? 'critical'
                  : score >= 50
                    ? 'high'
                    : score >= 25
                      ? 'medium'
                      : 'low';
            return (
              <button
                key={asset.id}
                className={`graph-node ${kind} ${layer ? level : ''}`}
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
                onClick={() => onAsset(asset)}
                aria-label={`Open asset ${asset.name}`}
              >
                <span>
                  <Icon size={large ? 23 : 19} />
                </span>
                <strong>{asset.name}</strong>
                {large && <small>{asset.address}</small>}
                {layer && (
                  <em>
                    {score === undefined
                      ? `${asset.criticality} criticality`
                      : `${score}/100 modeled risk`}
                  </em>
                )}
              </button>
            );
          })}
        </div>
        <span className="graph-zone">AUTHORIZED WORKSPACE / MODELED RELATIONSHIPS</span>
        <div className="graph-controls">
          <button
            aria-label="Zoom in"
            disabled={zoom >= 1.6}
            onClick={() => setZoom((value) => Math.min(1.6, value + 0.15))}
          >
            <Plus size={15} />
          </button>
          <button
            aria-label="Zoom out"
            disabled={zoom <= 0.7}
            onClick={() => setZoom((value) => Math.max(0.7, value - 0.15))}
          >
            <Minus size={15} />
          </button>
          <button aria-label="Reset zoom" onClick={() => setZoom(1)}>
            <Maximize2 size={14} />
          </button>
        </div>
      </div>
      <div className="graph-legend">
        <span>
          <i />
          Recorded demo
        </span>
        <span>
          <i className="dashed" />
          Inferred
        </span>
        <span>
          <i className="dotted" />
          Hypothetical
        </span>
        <small>No network traffic</small>
      </div>
    </div>
  );
}
