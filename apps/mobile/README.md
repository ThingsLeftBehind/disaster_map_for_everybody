# HinaNavi Mobile

React Native mobile app built with Expo.

## Quick Start

```bash
# From repo root
npm install
npm run dev:mobile
```

## API Base URL Configuration

The app needs to connect to the web API server. Configure based on your environment:

| Environment | Base URL |
|-------------|----------|
| iOS Simulator | `http://localhost:3000` (default) |
| Android Emulator | `http://10.0.2.2:3000` |
| Physical Device | `http://<YOUR_LAN_IP>:3000` |

### Setting for Physical Device

1. Find your computer's LAN IP (e.g., `192.168.1.100`)
2. Edit `app.json` -> `expo.extra.apiBaseUrl`:
   ```json
   "extra": {
     "apiBaseUrl": "http://192.168.1.100:3000"
   }
   ```
3. Restart Expo

## Development

```bash
# Start Expo
npm run dev:mobile

# Or run specific platform
cd apps/mobile
npx expo start --ios
npx expo start --android
```
