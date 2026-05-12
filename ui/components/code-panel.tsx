const code = `
function stabilizeSegments(data) {
  return data
    .filter(Boolean)
    .map((segment) => ({
      ...segment,
      zoom: smooth(segment.zoom),
    }));
}
`;

export function CodePanel() {
  return (
    <div className="bg-black rounded-2xl p-6 overflow-auto text-sm font-mono border border-zinc-800 h-[420px]">
      <pre className="whitespace-pre-wrap">
        {code}
      </pre>
    </div>
  );
}