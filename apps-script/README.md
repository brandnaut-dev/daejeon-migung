# 학생 기록 저장 연결 (구글 시트) — 약 3분

학생이 푸는 미궁 사이트는 GitHub Pages(정적)라서 서버가 없다.
기록은 구글 시트에 쌓고, Apps Script 웹앱이 창구 역할을 한다.

## 1. 시트 만들기
1. https://sheets.new 에서 새 스프레드시트 생성. 이름 예: `미궁_배재대_선원기록`
2. 메뉴 **확장 프로그램 > Apps Script** 클릭

## 2. 스크립트 붙여넣기
1. 편집기의 기본 코드를 모두 지우고 `Code.gs` 내용을 붙여넣기
2. 저장 (⌘S)

## 3. 웹앱으로 배포
1. 오른쪽 위 **배포 > 새 배포**
2. 톱니(유형 선택) > **웹 앱**
3. 설명: `migung v1` / 다음 사용자 인증 정보로 실행: **나** / 액세스 권한: **모든 사용자**
4. **배포** → 권한 승인(본인 구글 계정) → **웹 앱 URL** 복사 (`https://script.google.com/macros/s/.../exec`)

## 4. 사이트에 연결
`site/config.js` 의 `SHEET_ENDPOINT` 에 URL을 넣고 다시 배포한다.

```js
SHEET_ENDPOINT: "https://script.google.com/macros/s/XXXX/exec",
```

## 확인
- 브라우저에서 `웹앱URL?action=crew&key=captain` 을 열면 `{"ok":true,"rows":[]}` 가 보여야 한다.
- 사이트에서 선원 이름을 넣고 출항하면 시트에 `events`, `crew` 탭이 자동 생성되고 한 줄씩 쌓인다.
- 진행자 화면: `https://<pages 주소>/admin.html?key=captain`

## 코드 수정 후 다시 배포할 때
Apps Script는 **배포 > 배포 관리 > 연필 > 버전: 새 버전 > 배포** 를 눌러야 새 코드가 반영된다. URL은 그대로다.

## 저장되는 것
이름·학과·세션ID·문항별 시도/힌트/함께풀기 여부·선택 자원·고객·문제·아이디어 문장·브라우저 종류.
실명 외 개인정보(학번·연락처)는 받지 않는다.
