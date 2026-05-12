export function Topbar() {
  return (
    <header className="h-16 border-b border-zinc-800 bg-zinc-900 px-6 flex items-center justify-between">
      <div>
        <h1 className="text-xl font-bold">
          Synthetic Interaction Workspace
        </h1>
      </div>

      <div className="flex items-center gap-3">
        <input
          placeholder="Search interactions..."
          className="bg-zinc-800 h-11 w-72 rounded-xl px-4 outline-none border border-zinc-700"
        />

        <button className="h-11 px-5 rounded-xl bg-blue-600 hover:bg-blue-500 transition-all">
          Generate Script
        </button>
      </div>
    </header>
  );
}