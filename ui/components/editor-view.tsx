import { CodeEditor } from "./code-editor";

export function EditorView() {
  return (
    <div className="grid grid-cols-[1.2fr_0.8fr] gap-6 h-full">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">
            Generated Script
          </h2>

          <button className="h-10 px-4 rounded-xl bg-green-600 hover:bg-green-500">
            Apply Changes
          </button>
        </div>

        <CodeEditor />
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
        <h2 className="text-xl font-bold mb-5">
          Preview Timeline
        </h2>

        <div className="space-y-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="h-12 rounded-xl bg-zinc-800 hover:bg-zinc-700 transition-all"
            />
          ))}
        </div>
      </div>
    </div>
  );
}