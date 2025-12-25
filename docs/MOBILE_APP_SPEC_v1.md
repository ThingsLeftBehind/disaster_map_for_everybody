# 모바일 앱 설계서 (Mobile App Spec) v1

**프로젝트명**: 다국어 재난 대피 앱 (Mobile Mockup)
**플랫폼**: React Native (Expo) + TypeScript
**백엔드**: Next.js API (기존 Web 재사용) + Supabase

---

## 1. 개요 (Overview)
본 앱은 기존 웹 애플리케이션의 기능을 모바일 네이티브 경험으로 확장하며, **오프라인 모드**와 **푸시 알림**을 핵심 차별점으로 합니다. 웹의 동작을 미러링하되, 모바일 특화 기능(위치 기반 알림, 캐싱)을 추가합니다.

## 2. 주요 기능 및 규칙 (Core Specs)

### A. 프라이버시 중심 푸시 전략 (Privacy-First Push)
서버에 사용자의 정확한 GPS 위치를 저장하지 않습니다.
1. **Grid 방식**: 클라이언트는 위치를 포괄적인 "Grid Cell" ID로 변환하여 구독합니다.
2. **구독 제한**: 기기당 최대 **12개 Cell**까지 구독 가능.
3. **저장 정보**: `DevicePushToken`, `SubscribedCellIDs`, `Platform(iOS/Android)`, `LastSentState`.
4. **위치 추적 금지**: 연속적인 위치 기록(History)을 서버에 남기지 않습니다.

### B. 알림 규칙 (Notification Rules)
JMA(기상청) 경보/주의보/특별경보를 지원합니다.
1. **Deduplication (중복 방지)**: 동일한 (Cell, EventType, Severity)에 대해 **12시간** 내 재발송 금지.
2. **Severity Upgrade**: 주의보 -> 경보로 격상 시, 12시간 내라도 **즉시 발송**.

### C. 오프라인 대피소 (Offline Shelters)
네트워크가 끊긴 상황에서도 대피소를 확인할 수 있어야 합니다.
1. **캐싱 대상**:
   - 현재 설정된 "나의 지역(My Area)"
   - 최근 검색한 지역 **3곳**
2. **용량 관리**: 최대 **50MB** (Soft Limit). 초과 시 LRU(Least Recently Used) 방식으로 삭제.
3. **유효 기간 (TTL)**: 기본 14일. 단, 사용자가 "Pin(고정)"한 지역은 자동 삭제되지 않음.

### D. 데이터 업데이트 (Update Strategy)
1. **버전 체크**: 서버의 `dataVersion`을 확인하여 변경된 경우에만 캐시를 갱신.
2. **수동 임포트**: 서버 데이터는 관리자가 CSV Import로 갱신함(기존 워크플로우).

### E. 지도 정책 (Map Policy)
1. **Hazard Overlays**: 기본값 **OFF**. 사용자가 필요 시 켬.
2. **법적 고지**: 각 레이어 사용 시 한계점(Limitations)을 UI에 명시.
3. **성능**: 마커가 많을 경우 클러스터링 처리.

## 3. 화면 구성 (UI Architecture)

5-Tab 구조를 채택합니다.
1. **홈 (Main)**: 지도 기반 주변 대피소 찾기, 현재지 안부 등록.
2. **목록 (List)**: 대피소 리스트 검색 및 필터링.
3. **경보 (Alerts)**: 현재지/관심지역 기상 경보 상태.
4. **지진 (Quakes)**: 최근 지진 목록 및 강도.
5. **설정/하저드 (Hazard/Settings)**: 하저드 맵 오버레이 설정 및 앱 설정.

---

## 4. 기술 스택 (Tech Stack)
- **Framework**: Expo (Managed Workflow)
- **Language**: TypeScript
- **State Mgt**: React Context or Zustand
- **Map**: `react-native-maps` (Google Maps / Apple Maps)
- **Local DB**: `expo-sqlite` or `async-storage` for caching
- **API**: Existing Next.js API Routes (See Implementation Plan)
