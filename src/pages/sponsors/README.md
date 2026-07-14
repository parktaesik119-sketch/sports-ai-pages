# 후원업체 페이지 적용 가이드 (v2 — 실제 config.ts에 맞춰 수정)

## 이번에 바뀐 점

- `config.ts`는 이제 스니펫이 아니라 **완성본**이에요. 보내주신 실제 `config.ts`에
  `sponsors` 컬렉션만 추가해서 합쳐드렸습니다. 이 파일로 기존 `src/content/config.ts`를
  그대로 덮어쓰시면 됩니다 (posts 컬렉션 내용은 그대로 보존했어요).
- 이미지 방식을 `astro:assets`의 `image()`가 아니라, 원래 posts에서 쓰시던 방식
  (`homeLogo: z.string()...`)과 동일하게 **문자열 경로**로 통일했어요.
  → 그래서 `index.astro` / `[...slug].astro`도 `<Image />` 대신 그냥 `<img />` 태그로 수정했습니다.
- 후원사가 지금 0곳이어도 빌드가 깨지지 않도록 만들었어요. `src/content/sponsors/` 폴더가
  비어 있어도 목록 페이지는 "등록된 후원업체가 없습니다"라고만 뜨고 정상적으로 배포됩니다.
  (폴더 자체는 git에 남아있어야 해서 빈 폴더 대신 `.gitkeep` 파일을 하나 넣어뒀어요.)

## 파일 배치

```
src/content/config.ts                 ← 기존 파일을 이걸로 통째로 교체
src/content/sponsors/.gitkeep         ← 빈 폴더 유지용 (내용 없음, 그대로 두세요)
src/content/sponsors/_template.md.txt ← 나중에 후원사 추가할 때 쓰는 템플릿 (아직 .md 아님!)
src/pages/sponsors/index.astro        ← 목록 페이지 (/sponsors)
src/pages/sponsors/[...slug].astro    ← 상세 페이지 (/sponsors/후원사-slug)
```

지금 상태로 깃허브에 올리셔도 됩니다. `/sponsors`로 들어가면 "등록된 후원업체가
없습니다" 빈 페이지가 정상적으로 뜰 거예요.

## 나중에 실제 후원사가 생기면

1. `public/images/sponsors/` 폴더를 만들고 로고/배너/광고 이미지를 넣습니다.
   (예: `public/images/sponsors/samsung-logo.png`)
2. `src/content/sponsors/_template.md.txt`를 복사해서 `samsung.md`처럼 이름을 바꾸고
   `.md`로 저장합니다. (`.txt`인 상태로는 컬렉션에 잡히지 않아요 — 실수로 빈 카드가
   노출되는 걸 막으려고 일부러 이렇게 해뒀습니다.)
3. frontmatter의 `logo`, `banner`, `adImage` 값을 1번에서 넣은 실제 이미지 경로로
   바꿉니다. (예: `/images/sponsors/samsung-logo.png`)
4. 저장하고 다시 빌드하면 목록/상세 페이지에 자동으로 노출됩니다.

## 메뉴에 "후원업체" 추가

`/sponsors` 페이지는 지금 만들어드린 파일만으로는 메뉴에 노출되지 않아요.
`BaseLayout.astro`를 열어서 아래 두 곳에 링크를 추가해야 사용자가 메뉴에서
들어올 수 있습니다.

**PC 메뉴** (`<nav class="nav">` 안, 공지사항 다음 줄):
```astro
<a href="/sponsors" class={currentPath.startsWith('/sponsors') || currentCategory === 'sponsor' ? "active" : ""}>후원업체</a>
```

**모바일 메뉴** (`<div class="mobile-menu">` 안, 공지사항 다음 줄):
```astro
<a href="/sponsors" class={`menu sponsor ${currentPath.startsWith('/sponsors') ? 'active' : ''}`}>후원업체</a>
```

이 두 줄을 추가해야 진짜 "노출"이 시작됩니다. 페이지 파일만 올리는 것과
메뉴에 링크를 추가하는 것은 별개의 작업이에요.

## 체크리스트 (지금 바로 올려도 되는지)

- [x] `src/content/config.ts` 교체
- [x] `src/content/sponsors/.gitkeep` 추가
- [x] `src/pages/sponsors/index.astro` 추가
- [x] `src/pages/sponsors/[...slug].astro` 추가
- [ ] `BaseLayout.astro`에 메뉴 링크 2줄 추가 (직접 하셔야 해요)
- [ ] 후원사 생기면 `_template.md.txt` 복사해서 `.md`로 등록 (그때 하시면 돼요)

메뉴 링크만 추가하시면 지금 상태 그대로 배포 가능합니다.
