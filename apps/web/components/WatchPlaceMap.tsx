import dynamic from 'next/dynamic';
import type { WatchPlaceCoords } from './WatchPlaceMapInner';

const DynamicWatchPlaceMap = dynamic(() => import('./WatchPlaceMapInner'), {
  ssr: false,
  loading: () => <div className="flex h-[360px] items-center justify-center rounded-2xl border bg-gray-100 text-sm text-gray-600">地図を読み込んでいます...</div>,
});

type Props = {
  center: WatchPlaceCoords;
  selected: WatchPlaceCoords | null;
  onChange: (coords: WatchPlaceCoords) => void;
};

export default function WatchPlaceMap(props: Props) {
  return <DynamicWatchPlaceMap {...props} />;
}

export type { WatchPlaceCoords };
