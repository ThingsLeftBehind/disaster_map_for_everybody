export function intensityBadgeClasses(score: number | null): string {
  if (score === null) return 'bg-gray-100 text-gray-700 border-gray-200';
  if (score >= 6) return 'bg-red-600 text-white border-red-700';
  if (score >= 5) return 'bg-orange-500 text-white border-orange-600';
  if (score >= 4) return 'bg-amber-400 text-gray-900 border-amber-500';
  if (score >= 3) return 'bg-yellow-300 text-gray-900 border-yellow-400';
  return 'bg-gray-100 text-gray-700 border-gray-200';
}

export function intensityRowClasses(score: number | null): string {
  if (score === null) return 'bg-white';
  if (score >= 3) return 'bg-gray-50 ring-1 ring-gray-200';
  return 'bg-white';
}
