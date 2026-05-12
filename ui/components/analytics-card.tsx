interface Props {
  title: string;
  value: string;
}

export function AnalyticsCard({ title, value }: Props) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 h-32 flex flex-col justify-between hover:border-zinc-600 transition">
      <div className="text-sm text-zinc-400">
        {title}
      </div>

      <div className="text-3xl font-bold">
        {value}
      </div>
    </div>
  );
}