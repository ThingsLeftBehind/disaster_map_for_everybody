import dynamic from 'next/dynamic';

const Dynamic = dynamic(() => import('./HazardMapInner'), { ssr: false });

export default Dynamic;

