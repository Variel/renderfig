---
name: renderfig
description: Figma .fig 파일의 프레임을 PNG/JPG로 렌더링합니다. 텍스트, 이미지, 스타일을 오버라이드하여 템플릿 기반 이미지를 생성할 수 있습니다.
---

# renderfig 스킬

당신은 Figma `.fig` 파일을 이미지로 렌더링하는 전문가입니다. `renderfig` CLI 도구를 사용하여 .fig 파일의 특정 프레임을 PNG/JPG로 렌더링하고, 텍스트/이미지/스타일을 프로그래밍적으로 수정할 수 있습니다.

## 도구 개요

renderfig는 다음과 같은 파이프라인으로 동작합니다:

```
.fig 파일 → parsefig (파싱) → 노드 트리 + 이미지 추출
  → 오버라이드 적용 → HTML/CSS 생성 → Playwright 스크린샷 → PNG/JPG 출력
```

## 작업 절차

### 1단계: .fig 파일 구조 파악

작업 전 반드시 `inspect` 명령으로 파일 구조를 먼저 확인하세요.

```bash
# 페이지(캔버스) 목록 확인
npx renderfig inspect <파일경로>

# 특정 페이지의 프레임 목록 확인
npx renderfig inspect <파일경로> "페이지 이름"

# 프레임 내부 노드 구조 확인 (depth로 깊이 조절)
npx renderfig inspect <파일경로> "페이지/프레임" --depth 3

# 전체 트리 확인
npx renderfig inspect <파일경로> "페이지/프레임" --depth all
```

inspect 출력에서 다음을 확인합니다:
- **노드 이름**: 오버라이드 `target`으로 사용할 이름
- **노드 타입**: `[TEXT]`는 텍스트 교체 가능, `(image)`는 이미지 교체 가능
- **노드 크기**: 렌더링 결과의 기대 크기

### 2단계: 렌더링

```bash
npx renderfig render <파일경로> "페이지/프레임" -o output.png
```

### 3단계: 오버라이드 적용 (필요한 경우)

#### 텍스트 교체 `--text`

`--text "노드이름=새로운 텍스트"` 형식으로 텍스트 레이어의 내용을 교체합니다. 노드 이름은 1단계 inspect에서 확인한 이름을 사용합니다.

```bash
npx renderfig render design.fig "프로필 카드/Channy" \
  --text "Channy (차니)=새이름" \
  --text "Maker=디자이너" \
  -o output.png
```

#### 이미지 교체 `--image`

`--image "노드이름=이미지파일경로"` 형식으로 이미지 fill을 교체합니다.

```bash
npx renderfig render design.fig "프로필 카드/Channy" \
  --image "사진=./new-photo.jpg" \
  -o output.png
```

#### 스타일 수정 `--style`

`--style "노드이름.속성=값"` 형식으로 스타일 속성을 수정합니다.

```bash
npx renderfig render design.fig "프로필 카드/Channy" \
  --style "Channy (차니).fontSize=40" \
  --style "Channy (차니).color=#ff0000" \
  -o output.png
```

지원하는 스타일 속성:

**위치 & 크기**: `x`, `y`, `width`, `height`

**색상 & 외관**: `color` (hex), `backgroundColor` (hex), `opacity` (0-1), `visible` (true/false)

**Border**: `cornerRadius`, `borderRadiusTopLeft`, `borderRadiusTopRight`, `borderRadiusBottomLeft`, `borderRadiusBottomRight`, `strokeColor` (hex), `strokeWeight`

**Typography** (TEXT 노드): `fontSize`, `fontFamily`, `fontWeight` (Bold 등), `textAlign` (LEFT/CENTER/RIGHT), `textAlignVertical` (TOP/CENTER/BOTTOM), `lineHeight` (px), `lineHeightPercent` (%), `letterSpacing` (px), `textDecoration` (UNDERLINE/STRIKETHROUGH)

**Auto Layout** (FRAME 노드): `gap`, `padding`, `paddingHorizontal`, `paddingVertical`, `paddingTop`, `paddingRight`, `paddingBottom`, `paddingLeft`, `alignItems` (MIN/CENTER/MAX), `justifyContent` (MIN/CENTER/MAX/SPACE_BETWEEN)

#### 폰트 지정 `--font`

`--font "폰트패밀리=폰트파일경로"` 형식으로 로컬 폰트를 지정합니다. 지정하지 않은 폰트는 Google Fonts에서 자동 로딩을 시도하고, Google Fonts에도 없으면 시스템 폰트로 폴백합니다.

```bash
npx renderfig render design.fig "프로필 카드/Channy" \
  --font "Pretendard=./fonts/Pretendard-Regular.woff2" \
  -o output.png
```

### 출력 옵션

| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `-o, --output <path>` | 출력 파일 경로 (필수) | - |
| `--format png\|jpeg` | 출력 포맷 | 확장자에서 자동 감지 |
| `--quality <n>` | JPEG 품질 (0-100) | - |
| `--scale <n>` | 디바이스 스케일 팩터 | 1 |

## Programmatic API

Node.js 코드에서 직접 사용할 수도 있습니다:

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

## 작업 지침

- **항상 inspect 먼저**: 렌더링 전 반드시 `inspect`로 구조를 파악하세요. 노드 이름을 정확히 알아야 오버라이드가 동작합니다.
- **target 매칭**: 노드 이름 그대로 사용하거나 `/` 구분 경로 (예: `기본 정보/Channy (차니)`)로 지정합니다. 같은 이름의 노드가 여러 개면 경로를 사용하세요.
- **대량 생성**: 같은 템플릿으로 여러 이미지를 만들 때는 Programmatic API를 사용하는 스크립트를 작성하세요.
- **폰트 주의**: 한국어 폰트(Pretendard, SUIT 등)는 Google Fonts에 없는 경우가 많으므로 `--font`로 직접 지정해야 정확합니다.
- **VECTOR 미지원**: 복잡한 벡터/아이콘 노드는 렌더링되지 않습니다. 이 경우 해당 노드가 빠진 상태로 출력됩니다.
- **렌더링 결과 확인**: 렌더링 후 출력 이미지를 열어 결과를 확인하고, 필요하면 오버라이드를 조정하세요.
