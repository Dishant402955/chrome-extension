export function Topbar() {
  return (
    <header className="h-16 border-b border-zinc-800 bg-zinc-900 px-6 flex items-center justify-between">
      <div>
        <h1 className="text-xl font-semibold">
          Interaction Analytics Workspace
        </h1>
      </div>

      <div className="flex items-center gap-4">
        <input
          className="bg-zinc-800 rounded-xl px-4 py-2 outline-none"
          placeholder="Search sessions..."
        />

        <button className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-xl">
          Generate Report
        </button>
      </div>
    </header>
  );
}