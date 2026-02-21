# renderfig

Figma `.fig` 파일을 템플릿으로 사용하여, 텍스트/이미지/스타일을 프로그래밍적으로 수정한 뒤 특정 프레임을 PNG/JPG로 렌더링하는 CLI 도구.

## 파이프라인

```
.fig 파일 → parsefig (파싱) → 노드 트리 + 이미지 추출
  → 오버라이드 적용 (텍스트/이미지/스타일 수정)
  → HTML/CSS 생성
  → Playwright 스크린샷 → PNG/JPG 출력
```

## 설치

```bash
npm install renderfig
npx playwright install chromium
```

> Playwright가 스크린샷 촬영에 Chromium을 사용하므로, 최초 1회 `npx playwright install chromium`이 필요합니다.

## CLI 사용법

### `inspect` - .fig 파일 구조 탐색

```bash
# 페이지(캔버스) 목록
renderfig inspect design.fig

# 특정 페이지의 프레임 목록
renderfig inspect design.fig "페이지 이름"

# 특정 프레임의 하위 구조 (depth 지정)
renderfig inspect design.fig "페이지/프레임" --depth 3

# 전체 트리
renderfig inspect design.fig --depth all
```

출력 예시:

```
프로필 카드 [CANVAS]
  Channy [FRAME] 480x720 (auto-layout: VERTICAL)
    연락처 [FRAME] 384x120 (auto-layout: HORIZONTAL)
      레이블 [FRAME] 118x120 (auto-layout: VERTICAL)
        전화번호 [TEXT] 70x24
        이메일 [TEXT] 52x24
      값 [FRAME] 173x120 (auto-layout: VERTICAL)
        010-2923-5278 [TEXT] 142x24
        me@yechanny.com [TEXT] 173x24
    소개 [FRAME] 384x427 (auto-layout: VERTICAL)
      사진 [ROUNDED_RECTANGLE] 240x240 (image)
      기본 정보 [FRAME] 384x143 (auto-layout: VERTICAL)
        Channy (차니) [TEXT] 289x43
        Maker [TEXT] 55x29
```

### `render` - 프레임을 이미지로 렌더링

```bash
# 기본 렌더링
renderfig render design.fig "페이지/프레임" -o output.png
```

#### 텍스트 교체 `--text`

```bash
renderfig render design.fig "프로필 카드/Channy" \
  --text "Channy (차니)=새이름" \
  --text "Maker=디자이너" \
  -o output.png
```

#### 이미지 교체 `--image`

```bash
renderfig render design.fig "프로필 카드/Channy" \
  --image "사진=./new-photo.jpg" \
  -o output.png
```

#### 스타일 수정 `--style`

```bash
renderfig render design.fig "프로필 카드/Channy" \
  --style "Channy (차니).fontSize=40" \
  --style "Channy (차니).color=#ff0000" \
  --style "Maker.x=100" \
  -o output.png
```

지원하는 스타일 속성:

**위치 & 크기**
| 속성 | 설명 | 예시 |
|------|------|------|
| `x` | X 좌표 (px) | `100` |
| `y` | Y 좌표 (px) | `200` |
| `width` | 너비 (px) | `300` |
| `height` | 높이 (px) | `400` |

**색상 & 외관**
| 속성 | 설명 | 예시 |
|------|------|------|
| `color` | 채우기 색상 (텍스트 색상 겸용) | `#ff0000` |
| `backgroundColor` | 배경 색상 | `#f0f4ff` |
| `opacity` | 투명도 (0-1) | `0.5` |
| `visible` | 표시 여부 | `true` / `false` |

**Border**
| 속성 | 설명 | 예시 |
|------|------|------|
| `cornerRadius` | 모서리 반경 (전체) | `16` |
| `borderRadiusTopLeft` | 좌상단 반경 | `8` |
| `borderRadiusTopRight` | 우상단 반경 | `8` |
| `borderRadiusBottomLeft` | 좌하단 반경 | `8` |
| `borderRadiusBottomRight` | 우하단 반경 | `8` |
| `strokeColor` | 테두리 색상 | `#cccccc` |
| `strokeWeight` | 테두리 두께 (px) | `2` |

**Typography** (TEXT 노드)
| 속성 | 설명 | 예시 |
|------|------|------|
| `fontSize` | 글꼴 크기 (px) | `24` |
| `fontFamily` | 글꼴 패밀리 | `Pretendard` |
| `fontWeight` | 글꼴 스타일 (Bold 등) | `Bold` |
| `textAlign` | 수평 정렬 | `CENTER` / `LEFT` / `RIGHT` |
| `textAlignVertical` | 수직 정렬 | `TOP` / `CENTER` / `BOTTOM` |
| `lineHeight` | 줄 높이 (px) | `28` |
| `lineHeightPercent` | 줄 높이 (%) | `150` |
| `letterSpacing` | 자간 (px) | `1.5` |
| `textDecoration` | 텍스트 장식 | `UNDERLINE` / `STRIKETHROUGH` |

**Auto Layout** (FRAME 노드)
| 속성 | 설명 | 예시 |
|------|------|------|
| `gap` | 자식 간 간격 (px) | `12` |
| `padding` | 패딩 전체 (px) | `16` |
| `paddingHorizontal` | 좌우 패딩 (px) | `24` |
| `paddingVertical` | 상하 패딩 (px) | `16` |
| `paddingTop` | 상단 패딩 (px) | `8` |
| `paddingRight` | 우측 패딩 (px) | `8` |
| `paddingBottom` | 하단 패딩 (px) | `8` |
| `paddingLeft` | 좌측 패딩 (px) | `8` |
| `alignItems` | 교차축 정렬 | `MIN` / `CENTER` / `MAX` |
| `justifyContent` | 주축 정렬 | `MIN` / `CENTER` / `MAX` / `SPACE_BETWEEN` |

#### 폰트 지정 `--font`

```bash
renderfig render design.fig "프로필 카드/Channy" \
  --font "Pretendard=./fonts/Pretendard-Regular.woff2" \
  --font "Noto Sans KR=./fonts/NotoSansKR.woff2" \
  -o output.png
```

#### 출력 옵션

| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `-o, --output <path>` | 출력 파일 경로 (필수) | - |
| `--format png\|jpeg` | 출력 포맷 | 확장자에서 자동 감지, png |
| `--quality <n>` | JPEG 품질 (0-100) | - |
| `--scale <n>` | 디바이스 스케일 팩터 (1, 2, 3) | 1 |

## Programmatic API

```typescript
import { renderFrame } from 'renderfig';

const buffer = await renderFrame({
  figFile: './design.fig',
  frameName: '프로필 카드/Channy',
  output: './output.png',
  scale: 2,
  overrides: [
    { type: 'text', target: 'Channy (차니)', value: '새이름' },
    { type: 'image', target: '사진', src: './photo.jpg' },
    { type: 'style', target: 'Maker', props: { fontSize: 24, color: '#0066ff' } },
  ],
  fonts: [
    { family: 'Pretendard', src: './fonts/Pretendard-Regular.woff2' },
  ],
});
```

### `renderFrame(options): Promise<Buffer>`

| 속성 | 타입 | 설명 |
|------|------|------|
| `figFile` | `string` | .fig 파일 경로 |
| `frameName` | `string` | 렌더링할 프레임 경로 (`"페이지/프레임"`) |
| `output` | `string` | 출력 파일 경로 |
| `format` | `'png' \| 'jpeg'` | 출력 포맷 (기본: 확장자에서 감지) |
| `quality` | `number` | JPEG 품질 0-100 |
| `scale` | `number` | deviceScaleFactor (기본: 1) |
| `overrides` | `Override[]` | 텍스트/이미지/스타일 오버라이드 |
| `fonts` | `FontMapping[]` | 로컬 폰트 매핑 |

### Override 타입

```typescript
type Override =
  | { type: 'text'; target: string; value: string }
  | { type: 'image'; target: string; src: string }
  | { type: 'style'; target: string; props: Record<string, string | number> }
```

`target`은 노드 이름 (예: `"Channy (차니)"`) 또는 `/` 구분 경로 (예: `"기본 정보/Channy (차니)"`)로 지정합니다.

## 폰트 처리

렌더링 시 프레임에서 사용되는 모든 폰트 패밀리를 자동으로 수집하여 다음 순서로 처리합니다:

1. **`--font` 로컬 폰트** - 지정된 폰트 파일을 `@font-face`로 HTML에 인라인 임베드 (`.woff2`, `.woff`, `.ttf`, `.otf` 지원)
2. **Google Fonts 자동 로딩** - `--font`로 지정되지 않은 폰트는 [Google Fonts](https://fonts.google.com/) API에서 자동 로딩 시도
3. **시스템 폰트 폴백** - 위 두 방법 모두 해당하지 않으면 시스템에 설치된 폰트 또는 `sans-serif` 폴백

> Google Fonts에 없는 폰트(예: Pretendard, SUIT 등)는 `--font`로 직접 지정해야 정확하게 렌더링됩니다.

## 지원하는 Figma 노드

| Figma 노드 | 렌더링 방식 |
|------------|------------|
| FRAME (auto layout) | `display:flex` + `flex-direction` + `gap` + `padding` |
| FRAME (absolute) | `position:relative` / 자식 `position:absolute` |
| TEXT | `font-family/size/weight` + `color` + `text-align` |
| ROUNDED_RECTANGLE | `background` + `border-radius` |
| ELLIPSE | `border-radius:50%` |
| INSTANCE / COMPONENT | 재귀적으로 자식 렌더링 |
| IMAGE fill | `background-image: url(data:...)` 인라인 |
| VECTOR | 미지원 (스킵) |

## 라이선스

MIT
