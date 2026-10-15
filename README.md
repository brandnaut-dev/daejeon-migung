# 미궁 — 대전 보물항해

배재대학교 로컬 창업 캠프 **LOCAL WAVE 0→1** 의 개인 노트북용 웹 미궁 게임.
대전의 실제 사진 10장과 단서로 10개 섬을 순서대로 발견하고, 마지막에 자원 카드 2장 + 고객 + 문제로 창업 아이디어 한 문장을 만든다.

- 플레이: https://brandnaut-dev.github.io/daejeon-migung/
- 진행자 화면: https://brandnaut-dev.github.io/daejeon-migung/admin.html?key=captain
- 학생 기록 저장(구글 시트) 연결: [apps-script/README.md](apps-script/README.md)

## 구조
- `index.html` / `styles.css` / `app.js` — 게임 본체 (의존성 없음, 정적)
- `config.js` — 캠프명, 시트 엔드포인트, 진행자 키
- `data/puzzles.json` — 문항 10개(정답·힌트·해설). 기획 전달팩 원본 그대로
- `data/photos.json`, `photos/` — 사진 10장과 출처(Wikimedia Commons, CC BY-SA / KOGL)
- `fonts/` — Pretendard(본문), Galmuri11(픽셀 제목)
- `admin.html` — 진행자용 선원 기록 대시보드
- `apps-script/` — 구글 시트 저장 백엔드

## 사진 출처
`data/photos.json` 및 게임 내 "사진 출처" 참고. 모든 사진은 자르기·색상 변경 없이 비율 유지 축소만 했다.
