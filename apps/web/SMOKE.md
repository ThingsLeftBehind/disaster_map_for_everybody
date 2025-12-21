# Smoke test (Prompt 3/3)

Start:

```bash
npm run dev
```

UI routes:

- `http://localhost:3000/main`
- `http://localhost:3000/list`
- `http://localhost:3000/alerts`
- `http://localhost:3000/quakes`
- `http://localhost:3000/hazard`
- `http://localhost:3000/sources`
- `http://localhost:3000/ops` (requires `ADMIN_API_KEY` or `ADMIN_BASIC_*`)

Key internal APIs (curl):

```bash
curl -s http://localhost:3000/api/jma/status
curl -s http://localhost:3000/api/jma/quakes
curl -s "http://localhost:3000/api/jma/warnings?area=130000"

curl -s http://localhost:3000/api/gsi/hazard-layers

curl -s "http://localhost:3000/api/shelters/search?prefCode=13&limit=5"
curl -s "http://localhost:3000/api/shelters/nearby?lat=35.681236&lon=139.767125&limit=3&radiusKm=10"
```

Hazard tile verification:

```bash
node apps/web/scripts/verify-hazard-tiles.mjs
```

Manual checks:

- `/main`: マイエリアの追加/編集/削除（現在地/地図中心/手入力）と警報カウント表示
- `/shelters/[id]`: 投票/コメントは「送信」ボタンで1回送信（投票必須、コメント任意）
- `/hazard`: 液状化のタイルが `lcm25k_2012` を読みに行く

Store APIs (device id required; see browser localStorage `jp_evac_device_id`):

```bash
curl -s "http://localhost:3000/api/store/device?deviceId=YOUR_DEVICE_ID"
curl -s -X POST http://localhost:3000/api/store/checkin -H 'content-type: application/json' -d '{"deviceId":"YOUR_DEVICE_ID","status":"SAFE"}'

# Public banner (read)
curl -s http://localhost:3000/api/store/banner
```

Unit tests:

```bash
npm run test:jma
npm run test:store
```
