
/** While a page reads its numbers: frosted cards breathing. */
export default function Loading() {
  return (
    <div className="relative" aria-busy="true" aria-label="Loading">
      <div className="mb-6">
        <div className="frost h-6 w-56 !rounded-lg" />
        <div className="frost mt-2 h-3.5 w-80 !rounded-md" />
      </div>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="frost h-[92px]" style={{ animationDelay: `${i * 0.06}s` }} />
        ))}
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[2fr_1fr_1fr]">
        {[0, 1, 2].map((i) => (
          <div key={i} className="frost h-[250px]" style={{ animationDelay: `${0.1 + i * 0.06}s` }} />
        ))}
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[2fr_1fr_1fr]">
        {[0, 1, 2].map((i) => (
          <div key={i} className="frost h-[200px]" style={{ animationDelay: `${0.2 + i * 0.06}s` }} />
        ))}
      </div>
    </div>
  );
}
