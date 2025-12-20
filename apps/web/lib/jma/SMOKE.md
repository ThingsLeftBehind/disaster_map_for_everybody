# JMA internal API smoke checks

Start the dev server:

```bash
npm run dev
```

Then in another terminal:

```bash
curl -s http://localhost:3000/api/jma/status
curl -s http://localhost:3000/api/jma/quakes
curl -s "http://localhost:3000/api/jma/warnings?area=130000"
curl -s "http://localhost:3000/api/jma/raw?feed=extra"
```

Run unit tests:

```bash
npm run test:jma
```
