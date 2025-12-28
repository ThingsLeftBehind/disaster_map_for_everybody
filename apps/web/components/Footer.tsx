import Link from 'next/link';

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-10 border-t bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-5 text-sm text-gray-700 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>© {year} HinaNavi</span>
          <span>
            Contact:{' '}
            <a className="text-blue-600 hover:underline" href="mailto:contact@hinanavi.com">
              contact@hinanavi.com
            </a>
          </span>
          <Link href="/sources" className="text-blue-600 hover:underline">
            出典
          </Link>
        </div>
      </div>
    </footer>
  );
}
