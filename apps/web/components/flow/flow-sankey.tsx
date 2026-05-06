"use client";

import { useMemo, useRef, useState } from "react";
import {
  sankey,
  sankeyLinkHorizontal,
  sankeyCenter,
  type SankeyGraph
} from "d3-sankey";

type Node = {
  id: string;
  label: string;
  type: "income" | "account" | "spending" | "investment" | "debt";
};
type Link = {
  source: string;
  target: string;
  value: number;
  count: number;
};

type Props = {
  nodes: Node[];
  links: Link[];
  width?: number;
  height?: number;
  onLinkClick?: (link: Link) => void;
  onNodeClick?: (node: Node) => void;
};

// d3-sankey mutates the objects you pass it and replaces source/target
// references with the actual node objects. We work on deep copies.
type D3Node = Node & {
  index?: number;
  x0?: number;
  x1?: number;
  y0?: number;
  y1?: number;
  value?: number;
};
type D3Link = Omit<Link, "source" | "target"> & {
  source: D3Node;
  target: D3Node;
  width?: number;
  y0?: number;
  y1?: number;
};

const TYPE_COLORS: Record<Node["type"], string> = {
  income: "#225f59", // --accent (teal)
  account: "#c9a96b", // --gold
  spending: "#665d4e", // --muted
  investment: "#163d4a", // --accent-deep
  debt: "#a84427" // warm red
};

function currency(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}

export function FlowSankey(props: Props) {
  const width = props.width ?? 1100;
  const height = props.height ?? Math.max(420, props.nodes.length * 18);
  const [hoveredLink, setHoveredLink] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const graph = useMemo<SankeyGraph<D3Node, D3Link> | null>(() => {
    if (props.nodes.length === 0 || props.links.length === 0) return null;

    // Deep clone; d3-sankey mutates.
    const clonedNodes: D3Node[] = props.nodes.map((n) => ({ ...n }));
    // For d3-sankey we can pass source/target as string IDs because we set
    // nodeId((n) => n.id) below. Internally it'll look them up.
    const clonedLinks = props.links.map((l) => ({
      source: l.source,
      target: l.target,
      value: l.value,
      count: l.count
    }));

    // Sanity-check references before handing off — cheaper than catching
    // d3-sankey's opaque "missing" error at runtime.
    const nodeIds = new Set(clonedNodes.map((n) => n.id));
    for (const link of clonedLinks) {
      if (!nodeIds.has(link.source) || !nodeIds.has(link.target)) {
        // Skip silently; bad data shouldn't crash the whole diagram.
        return null;
      }
    }

    const margin = { top: 14, right: 180, bottom: 14, left: 160 };
    const layoutWidth = Math.max(320, width - margin.left - margin.right);
    const layoutHeight = Math.max(240, height - margin.top - margin.bottom);

    const layout = sankey<D3Node, D3Link>()
      .nodeId((n) => (n as D3Node).id)
      .nodeAlign(sankeyCenter)
      .nodeWidth(12)
      .nodePadding(14)
      .extent([
        [margin.left, margin.top],
        [margin.left + layoutWidth, margin.top + layoutHeight]
      ]);

    const computed = layout({
      nodes: clonedNodes,
      // d3-sankey will resolve string IDs → node refs internally.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      links: clonedLinks as any
    });
    return computed;
  }, [props.nodes, props.links, width, height]);

  if (!graph) {
    return (
      <div className="flowSankeyEmpty">
        No flow data for this window yet. Sync your accounts or pick a wider
        time range.
      </div>
    );
  }

  const linkPath = sankeyLinkHorizontal<D3Node, D3Link>();

  // Sort links so that hovered link renders on top.
  const sortedLinks = [...graph.links].sort((a, b) => {
    const aKey = `${a.source.id}|${a.target.id}`;
    const bKey = `${b.source.id}|${b.target.id}`;
    if (hoveredLink === aKey) return 1;
    if (hoveredLink === bKey) return -1;
    return 0;
  });

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className="flowSankeySvg"
      role="img"
      aria-label="Money flow diagram"
    >
      {/* Links */}
      <g className="flowLinks" fill="none">
        {sortedLinks.map((link) => {
          const key = `${link.source.id}|${link.target.id}`;
          const isHovered = hoveredLink === key;
          const isRelated =
            hoveredNode === link.source.id || hoveredNode === link.target.id;
          const anyHighlightActive = hoveredLink !== null || hoveredNode !== null;
          const dim = anyHighlightActive && !isHovered && !isRelated;
          const color = TYPE_COLORS[link.source.type];
          return (
            <path
              key={key}
              d={linkPath(link) ?? ""}
              stroke={color}
              strokeOpacity={dim ? 0.1 : isHovered ? 0.85 : 0.42}
              strokeWidth={Math.max(1, link.width ?? 1)}
              onMouseEnter={() => setHoveredLink(key)}
              onMouseLeave={() => setHoveredLink(null)}
              onClick={() => {
                if (props.onLinkClick) {
                  props.onLinkClick({
                    source: link.source.id,
                    target: link.target.id,
                    value: link.value,
                    count: link.count
                  });
                }
              }}
              style={{ cursor: props.onLinkClick ? "pointer" : "default" }}
            >
              <title>
                {link.source.label} → {link.target.label}: {currency(link.value)}
                {link.count ? ` · ${link.count} tx` : ""}
              </title>
            </path>
          );
        })}
      </g>

      {/* Nodes */}
      <g className="flowNodes">
        {graph.nodes.map((node) => {
          const isHovered = hoveredNode === node.id;
          const dim =
            (hoveredLink !== null || hoveredNode !== null) && !isHovered;
          const color = TYPE_COLORS[node.type];
          const x = node.x0 ?? 0;
          const y = node.y0 ?? 0;
          const w = (node.x1 ?? 0) - (node.x0 ?? 0);
          const h = (node.y1 ?? 0) - (node.y0 ?? 0);
          const leftSide = node.type === "income";
          return (
            <g
              key={node.id}
              onMouseEnter={() => setHoveredNode(node.id)}
              onMouseLeave={() => setHoveredNode(null)}
              onClick={() => props.onNodeClick?.(node)}
              style={{ cursor: props.onNodeClick ? "pointer" : "default" }}
              opacity={dim ? 0.35 : 1}
            >
              <rect
                x={x}
                y={y}
                width={w}
                height={Math.max(4, h)}
                fill={color}
                rx={3}
              >
                <title>
                  {node.label}: {currency(node.value ?? 0)}
                </title>
              </rect>
              <text
                x={leftSide ? x - 8 : (node.x1 ?? 0) + 8}
                y={y + h / 2}
                dy="0.35em"
                fontSize={12}
                fontFamily="var(--font-sans)"
                textAnchor={leftSide ? "end" : "start"}
                fill="#171512"
              >
                {node.label}
                <tspan
                  dx={leftSide ? "-0.5em" : "0.5em"}
                  fontSize={11}
                  fill="#665d4e"
                >
                  {currency(node.value ?? 0)}
                </tspan>
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
