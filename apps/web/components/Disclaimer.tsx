export default function Disclaimer() {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <div className="font-semibold">情報のご利用にあたって</div>
      <p className="mt-1 leading-relaxed">
        本サービスの避難情報は国土地理院や自治体等のオープンデータを基にしています。最新の公式発表を必ず確認し、避難の判断はご自身と周囲の安全を最優先してください。位置情報は端末内で最小限に扱われ、ログイン不要で利用できます。
      </p>
    </div>
  );
}
