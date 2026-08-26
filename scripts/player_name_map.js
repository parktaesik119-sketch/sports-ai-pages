// ============================================================
// 픽천국 K리그 선수/감독명 한글 매핑 테이블 (PLAYER_NAME_MAP)
// fotmob에 표기된 영문 이름 → 한글 성명
//
// 대상: K리그1(12개 팀) + K리그2(17개 팀, 2026시즌 기준) 전 구단 등록선수 +
//       한국 국적 감독. fotmob 국적이 "South Korea(한국)"으로 표시된 인원만
//       포함(북한 국적도 별도 추가돼 있음 — Kang Dong-Hui, Lee Yong-Jick).
//
// ⚠️ key 표기 순서 주의: fotmob 팀 스쿼드 페이지(/teams/{id}/squad/...)는
// "Surname GivenName" 순서로 이름을 보여주지만(예: "Gu Sung-Yun"), 실제 이
// 사이트가 라인업/본문에 쓰는 fotmob 데이터(경기별 라인업)는 "GivenName
// Surname" 순서(예: "Sung-Yun Gu")로 나온다는 게 실사용으로 확인됨(2026-08).
// 그래서 이 파일의 key는 전부 "GivenName Surname" 순서로 뒤집어서 넣었다 —
// team_name_map.js처럼 "실제 서비스에 찍히는 원문 그대로"를 key로 써야 매칭이
// 되기 때문. 원래 스쿼드 페이지 순서(Surname GivenName)로 된 값이 다른 곳에서
// 또 나온다면 team_name_map.js의 PSG 사례처럼 별도 key로 추가하면 된다.
//
// 예외적으로 아래 3명은 fotmob 스쿼드 페이지 자체에서부터 이미
// "GivenName Surname" 순서로 나와 있어서 뒤집지 않고 그대로 뒀다:
// "Kyung-Tae Lee", "June-Hyuk Ahn", "Mun-Gyeong Sung"
//
// ⚠️ 이 파일은 2026-08 시점 fotmob 스쿼드 페이지를 직접 조회해서 만든
// "1차 초안"입니다. team_name_map.js와 마찬가지로, 로마자 표기만으로는
// 정확한 한글 성명을 100% 확정할 수 없는 경우가 많습니다(동음이의 한글 표기,
// 선수 개인이 선택한 여권/등록 표기 스타일이 제각각이라 규칙적인 변환이
// 불가능함). 아래에서 "// 확인 필요"로 표시한 항목은 표준적인 발음 변환으로
// 추정만 한 것이니 실제 매칭 결과를 보면서 보정해 나가는 걸 권장합니다.
// (유명/주전급 선수는 알려진 실명으로 확인해서 넣었고, 후보/유스 선수 위주로
// 불확실성이 남아있습니다.)
//
// ⚠️ 성씨 로마자 표기가 fotmob 내에서도 endpoint마다 다르게 나오는 경우가
// 있다(예: "Jeong Seung-Won"(스쿼드 페이지) vs "Seung-Won Jung"(실제 라인업) —
// 같은 선수인데 Jeong/Jung으로 다름, 2026-08 실사용 확인). 이런 케이스를
// 만나면 team_name_map.js에서 해온 것처럼 두 표기를 각각 별도 key로 다
// 추가해주면 된다(아래 "Seung-Won Jung" 예시 참고). 전수 검증은 못 했으니
// 매칭 안 되는 선수가 보이면 이런 식으로 계속 보정해나가면 된다.
//
// 📌 slug.astro 연동: 이 파일은 slug.astro에서 PLAYER_NAME_MAP으로 import되어
// (1) 통합 라인업 위젯, 포메이션 피치뷰(SVG), 감독 표시, 결장/부상 목록 등
// 선수명이 단독으로 나오는 모든 위치와 (2) 전력분석/요약/제목 등 "본문 텍스트"
// 안에 선수명이 문장 형태로 섞여 나오는 경우 모두에 적용된다(translatePlayer /
// translatePlayersInText 함수, team_name_map.js의 translateTeam /
// translateTeamsInText와 동일한 설계).
// ============================================================

const PLAYER_NAME_MAP = {

  // ===== ⚽ K리그1 =====

  // --- FC Seoul (FC 서울) ---
  "Jun-Sub Lim": "임준섭",
  "Hyeon-Mu Kang": "강현무",
  "Ki-Wook Yun": "윤기욱", // 확인 필요
  "Sung-Yun Gu": "구성윤",
  "Jun Choi": "최준",
  "Soo-Il Park": "박수일",
  "Sang-Min Lee": "이상민",
  "Han-Do Lee": "이한도",
  "Seong-Hoon Park": "박성훈",
  "Jin-Su Kim": "김진수",
  "Jae-Min Ahn": "안재민",
  "Min-Jun Kim": "김민준",
  "Seung-Mo Lee": "이승모",
  "Pil-Gwan Ko": "고필관",
  "Jee-Won Kim": "김지원",
  "Do-Yun Hwang": "황도윤",
  "Jeong-Beom Son": "손정범",
  "Jang Han-Gyeol Park": "박장한결", // 확인 필요 - fotmob 표기 순서 특이
  "Seung-Won Jeong": "정승원",
  "Seung-Won Jung": "정승원", // 실제 라인업 데이터에서는 "Jeong" 대신 "Jung"으로 나옴(2026-08 확인) — endpoint별 표기차
  "Seon-Min Moon": "문선민",
  "Min-Kyu Song": "송민규",
  "Hyeon-Woo Jeong": "정현우",
  "Young-Wook Cho": "조영욱",
  "Seong-Hoon Cheon": "천성훈",

  // --- Ulsan HD FC (울산 HD) ---
  "Byeong-Geun Hwang": "황병근",
  "Ju-Ho Choi": "최주호",
  "Seong-Min Ryu": "류성민",
  "Hyeon-Woo Jo": "조현우",
  "Jung-In Moon": "문정인",
  "Jong-Gyu Yoon": "윤종규",
  "Seok-Hyun Choi": "최석현",
  "Seong-Bin Jung": "정성빈",
  "Yong-Woo Park": "박용우",
  "Myong-Gwan Seo": "서명관",
  "Seung-Hyun Jung": "정승현",
  "Young-Gwon Kim": "김영권",
  "Jae-Ik Lee": "이재익",
  "Hyun-Taek Cho": "조현택",
  "Sang-Min Sim": "심상민",
  "Woo-Jin Park": "박우진",
  "Gyu-Sung Lee": "이규성",
  "Min-seo Jo": "조민서",
  "Jae-Sang Jeong": "정재상",
  "Si-Young Jang": "장시영",
  "Jin-Hyun Lee": "이진현",
  "Hui-Gyun Lee": "이희균",
  "In-Woo Back": "백인우",
  "Sang-Woo Kang": "강상우",
  "Dong-Gyeong Lee": "이동경",

  // --- Jeonbuk Hyundai Motors FC (전북 현대) ---
  "Ju-Hyun Lee": "이주현",
  "Bum-Keun Song": "송범근",
  "Tae-Hwan Kim": "김태환", // 전북 소속 (강원 소속 동명이인과 별개)
  "Young-Bin Kim": "김영빈",
  "Je-Un Yeon": "연제운",
  "Wi-Je Cho": "조위제",
  "Ji-Soo Park": "박지수",
  "Ha-Jun Kim": "김하준",
  "Sang-Myung Lee": "이상명",
  "Woo-Jin Choi": "최우진",
  "Tae-Hyun Kim": "김태현",
  "Jin-Gyu Kim": "김진규",
  "Seong-Ung Maeng": "맹성웅",
  "Yeong-Jae Lee": "이영재",
  "Sang-Yoon Kang": "강상윤",
  "Sang-Yun Kang": "강상윤",
  "Dong-Jun Lee": "이동준",
  "Seung-Woo Lee": "이승우",
  "Seung-Sub Kim": "김승섭",

  // --- Gangwon FC (강원 FC) ---
  "Cheong-Hyo Park": "박청효",
  "Chung-Hyo Park": "박청효",
  "Jin-Hyeok Hong": "홍진혁",
  "Min-Kyu Cho": "조민규",
  "Jung-Hun Kim": "김정훈",
  "Do-Hyun Kim": "김도현",
  "Joon-Hyuck Kang": "강준혁",
  "Joon-hyuck Kang": "강준혁",
  "Seong-Yun Kang": "강성윤",
  "Seok-Joo Kwon": "권석주",
  "Gi-Hyuk Lee": "이기혁",
  "Ho-Yeong Park": "박호영",
  "Hyo-Bin Lee": "이효빈",
  "Jae-Hyeok Choi": "최재혁",
  "Seung-Bin Jeong": "정승빈",
  "Jeong-Hyun Lee": "이정현",
  "Min-Ha Shin": "신민하",
  "Chul Hong": "홍철",
  "Min-Woo Seo": "서민우",
  "Dong-Hyun Kim": "김동현",
  "Seung-Won Lee": "이승원",
  "Eun-Chong Hwang": "황은총",
  "Hee-Do Won": "원희도",
  "Eo-Jin Kim": "김어진",
  "Yong-Jae Lee": "이용재",
  "Jun-Yeop Yeo": "여준엽",
  "You-Hyeon Lee": "이유현",
  "Yu-Sung Kim": "김유성",
  "Yun-Gu Kang": "강윤구",
  "Jae-Hyeon Mo": "모재현",
  "Dae-Won Kim": "김대원",
  "Jun-Seo Jin": "진준서",
  "Byung-Heon Yoo": "유병헌",
  "Eun-Ho Lee": "이은호",
  "Ji-Nam Choe": "최지남",
  "Won-Woo Cho": "조원우",
  "Gun-Hee Kim": "김건희",
  "Young-Jun Goh": "고영준",
  "Young-Joon Goh": "고영준",
  "Sang-Hyeok Park": "박상혁", // 강원 소속 (성남 소속 동명이인과 별개)
  "Ji-Ho Lee": "이지호",
  "Byeong-Chan Choe": "최병찬",
  "Byeong-Chan Choi": "최병찬",

  // --- Jeju SK (제주 SK) ---
  "Dong-Jun Kim": "김동준",
  "Seung-Min Joo": "주승민",
  "Ja-Woong Heo": "허자웅",
  "Chang-Woo Rim": "임창우",
  "In-Soo Yu": "유인수",
  "Min-Jae Park": "박민재",
  "Kang-Jun Heo": "허강준",
  "Ki-Min Kwon": "권기민",
  "Jae-Woo Kim": "김재우",
  "Woon Chung": "정운",
  "Woon Jeong": "정운",
  "Ryun-Seong Kim": "김륜성",
  "In-Jung Jo": "조인정",
  "Su-Bin Park": "박수빈", // 제주 소속 (파주 소속 동명이인과 별개)
  "Chang-Min Lee": "이창민",
  "Min-gyu Jang": "장민규",
  "Min-Kyu Jang": "장민규",
  "Seung-Jae Yoo": "유승재",
  "Byung-Wook Choi": "최병욱",
  "Chang-Jun Park": "박창준",
  "Jae-Min Kim": "김재민",
  "Sang-Eun Shin": "신상은",
  "Sin-Jin Kim": "김신진",
  "Dong-Hui Kang": "강동휘",

  // --- Pohang Steelers (포항 스틸러스) ---
  "Pyung-Guk Yoon": "윤평국",
  "In-Jae Hwang": "황인재",
  "Seong-Min Hong": "홍성민",
  "Sung-Min Hong": "홍성민",
  "Neung Kwon": "권능",
  "Sung-Wook Jo": "조성욱",
  "Min-Gwang Jeon": "전민광",
  "Min-Kwang Jeon": "전민광",
  "Si-Woo Jin": "진시우",
  "Kwang-Hoon Shin": "신광훈",
  "Chan-Yong Park": "박찬용",
  "Young-Jun Cho": "조영준",
  "Ho-Jin Kim": "김호진",
  "Dae-Geun Yun": "윤대근",
  "Ye-Sung Kim": "김예성",
  "Seung-Ho Kim": "김승호",
  "Dong-Jin Kim": "김동진", // 포항 소속 (안양 소속 동명이인과 별개)
  "Gwang-won Kim": "김광원",
  "Bum-Jun Kim": "김범준",
  "Sung-Yueng Ki": "기성용",
  "Soo-Ah Lee": "이수아",
  "Min-Jun Kang": "강민준",
  "Chang-Woo Lee": "이창우",
  "Jeong-Won Eo": "어정원",
  "Seo-Ung Hwang": "황서웅",
  "Seo-Woong Hwang": "황서웅",
  "Jae-Jun An": "안재준",
  "Yong-Hak Kim": "김용학",
  "Jae-Hwan Hwang": "황재환",
  "Seung-Won Baek": "백승원",
  "Ki-Jong Won": "원기종",
  "Sang-Hyeok Cho": "조상혁",
  "Han-Min Jung": "정한민",

  // --- FC Anyang (FC 안양) ---
  "Jeong-Hoon Kim": "김정훈",
  "Da-Sol Kim": "김다솔",
  "Sung-Dong Kim": "김성동",
  "Ji-Hoon Kang": "강지훈",
  "Tae-Hee Lee": "이태희",
  "Hyun-Woo Joo": "주현우",
  "Ji-Hoon Kim": "김지훈", // 안양 소속 (수원FC 소속 동명이인과 별개)
  "Chang-Yong Lee": "이창용",
  "Young-Chan Kim": "김영찬",
  "Kyung-Won Kwon": "권경원",
  "Dong-Jin Kim": "김동진", // 안양 소속 (포항 소속 동명이인과 별개)
  "Jae-Hyun Kim": "김재현",
  "Jun-Yeon Jeong": "정준연",
  "Jong-Hyun Park": "박종현",
  "Ji-Wan Kang": "강지완",
  "Jung-Hyun Kim": "김정현", // 안양 소속 (안산 소속 동명이인과 별개)
  "Ka-Ram Han": "한가람", // 확인 필요
  "Bo-Kyung Kim": "김보경",
  "Jin-Yong Lee": "이진용",
  "Jung-Woo Jang": "장정우",
  "Geon-Joo Choi": "최건주",
  "Hyun-Woo Chae": "채현우",
  "Seong-Woo Moon": "문성우",
  "Jeong-Hun Park": "박정훈",
  "Kang Kim": "김강",
  "Hyeong-Jun Oh": "오형준",
  "Un Kim": "김운",

  // --- Incheon United (인천 유나이티드) ---
  "Dong-Heon Kim": "김동헌",
  "Tae-Hui Lee": "이태희",
  "Min-Jun Wang": "왕민준",
  "Sang-Gi Lee": "이상기",
  "Seung-Gu Choi": "최승구",
  "Myung-Sun Kim": "김명순",
  "Myung-Soon Kim": "김명순",
  "Yeon-Soo Kim": "김연수", // 인천 소속 (경남 소속 동명이인과 별개)
  "Geon-Hui Kim": "김건희",
  "Kyung-Sub Park": "박경섭",
  "Jeong-Min Go": "고정민",
  "Jun-Seop Lee": "이준섭",
  "Seung-Won Yeo": "여승원",
  "Ju-Yong Lee": "이주용",
  "Yong-Hwan Kim": "김용환",
  "Min-Hyeok Lee": "이민혁",
  "Myung-Joo Lee": "이명주",
  "Myeong-Ju Lee": "이명주",
  "Ji-Hwan Mun": "문지환",
  "Jae-Min Seo": "서재민", // 인천 소속 (수원FC 소속 동명이인과 별개)
  "Young-Whan Kim": "김영환",
  "Won-Jin Jung": "정원진",
  "Dong-Ryul Lee": "이동률",
  "Seong-Min Kim": "김성민",
  "Hu-Seong Oh": "오후성", // 확인 필요
  "Min-Gyu Baek": "백민규",
  "Chi-In Jeong": "정치인", // 확인 필요
  "Chung-Yong Lee": "이청용",
  "Seung-Ho Park": "박승호",

  // --- Bucheon FC 1995 (부천 FC 1995) ---
  "Sang-Hyeon Lee": "이상현",
  "Hyung-Geun Kim": "김형근",
  "Hyeon-Yeop Kim": "김현엽",
  "Jae-Won Shin": "신재원",
  "Jong-Min Kim": "김종민", // 부천 소속 (충남아산 소속 동명이인과 별개)
  "Ho-Jin Jeong": "정호진",
  "Sung-Wook Hong": "홍성욱",
  "Dong-Gyu Baek": "백동규",
  "Ye-Chan Lee": "이예찬",
  "Jae-Won Lee": "이재원", // 부천 소속 (수원FC 소속 동명이인과 별개)
  "Seung-Hyeon Yu": "유승현",
  "Ye-Geon Sung": "성예건",
  "Bit-Garam Yoon": "윤빛가람",
  "Jong-Woo Kim": "김종우",
  "Sang-Jun Kim": "김상준",
  "Shin Sung": "성신",
  "Gyu-Min Kim": "김규민", // 부천 소속 (경남 소속 동명이인과 별개)
  "Bong-Hun Yeo": "여봉훈",
  "Tae-Hyun An": "안태현",
  "Min-Jun Kim": "김민준", // 부천 소속 (서울 소속 동명이인과 별개)
  "Jae-Woo Kang": "강재우",
  "Ji-Ho Han": "한지호",
  "Dong-Hyeon Kim": "김동현",
  "Dam Uh": "어담",
  "Seung-Bin Kim": "김승빈",
  "Seong-Jun Jo": "조성준",
  "Jeong-In Park": "박정인",
  "Eui-Hyung Lee": "이의형",

  // --- Daejeon Hana Citizen (대전 하나 시티즌) ---
  "Chang-Geun Lee": "이창근",
  "Jun-Seo Lee": "이준서",
  "Min-Soo Kim": "김민수",
  "Kyung-Tae Lee": "이경태", // 확인 필요 - fotmob 표기 순서 반대
  "Jin-Ya Kim": "김진야",
  "Jae-Suk Oh": "오재석",
  "Moon-Hwan Kim": "김문환",
  "Min-Duk Kim": "김민덕",
  "Seong-Gwon Cho": "조성권",
  "Sung-Kwon Jo": "조성권",
  "Jong-Eun Lim": "임종은",
  "Chang-Rae Ha": "하창래",
  "Kyu-Hyun Park": "박규현",
  "Myung-Jae Lee": "이명재",
  "Young-Jae Seo": "서영재",
  "Yun-Sung Kang": "강윤성",
  "Jun-Beom Kim": "김준범",
  "Hyun-Sik Lee": "이현식",
  "Bong-Soo Kim": "김봉수",
  "Hun-Min Koo": "구훈민",
  "Byeong-Chan Park": "박병찬",
  "Soon-Min Lee": "이순민",
  "Hyeon-Ug Kim": "김현욱",
  "Won-Sang Um": "엄원상",
  "Jin-Su Seo": "서진수",
  "Do-Yeon Kim": "김도연", // 대전 소속 (제주 소속 동명이인과 별개)
  "Jae-Hee Jeong": "정재희",
  "Ji-Ho Kim": "김지호", // 대전 소속 (수원삼성 소속 동명이인과 별개)
  "Geon-Ho Moon": "문건호",
  "Min-Kyu Joo": "주민규",
  "Kang-Hyun Yu": "유강현",

  // --- Gimcheon Sangmu (김천 상무) ---
  "Chan-Gi An": "안찬기",
  "Sang-Young Park": "박상영",
  "Jong-Beom Baek": "백종범",
  "Hyun-Ho Moon": "문현호",
  "Man-Ho Park": "박만호",
  "Joon-Soo Ahn": "안준수",
  "Jin-Ho Kim": "김진호", // 김천 소속 (용인 소속 동명이인과 별개)
  "Si-Hoo Hong": "홍시후",
  "Young-Hun Kang": "강영훈",
  "Jun-Young Lim": "임준영",
  "Hyun-Woo Kim": "김현우",
  "Min-Kyu Kim": "김민규",
  "Dug-Keun Lim": "임덕근",
  "Jung-Taek Lee": "이정택",
  "Seo-Jin Kim": "김서진",
  "Jun-Soo Byeon": "변준수",
  "Jun-Seok Song": "송준석",
  "Cheol-Woo Park": "박철우",
  "Jin-Seong Park": "박진성",
  "Min-Seo Park": "박민서",
  "Gyu-Hyeon Choi": "최규현",
  "Won-Jin Hong": "홍원진",
  "Jae-Hyeok Oh": "오재혁",
  "Soo-Bin Lee": "이수빈",
  "Yi-Seok Kim": "김이석",
  "Chan-Ouk Lee": "이찬욱",
  "Ma-Ho Chung": "정마호",
  "Kyung-Ho Roh": "노경호",
  "Tae-Jun Park": "박태준",
  "Tae-Joon Park": "박태준",
  "Kang-Hyun Lee": "이강현",
  "Kang-Hyeon Lee": "이강현",
  "Gyeong-Hyeon Min": "민경현",
  "Jun-Ha Kim": "김준하",
  "Jae-Hyun Go": "고재현",
  "Byung-Kwan Jeon": "전병관",
  "Yong-Hui Park": "박용희",
  "Ji-Won Park": "박지원",
  "Ju-Chan Kim": "김주찬",
  "Yun-Sang Hong": "홍윤상",
  "In-Gyun Kim": "김인균",
  "Ju-Hyeok Kang": "강주혁",
  "Jae-Seok Yoon": "윤재석",
  "Gyung-Jun Byeon": "변경준",
  "Yool Heo": "허율",
  "Kun-Hee Lee": "이건희",
  "Se-Jin Park": "박세진", // 김천 소속 (충남아산 소속 동명이인과 별개)
  "Sang-Heon Lee": "이상헌",
  "Min-Geu Kang": "강민구",
  "Jae-Min Jeong": "정재민",

  // --- Gwangju FC (광주 FC) ---
  "Kyeong-Min Kim": "김경민",
  "Dong-Hwa Kim": "김동화",
  "Yoon-Sung Lee": "이윤성",
  "Seung-Un Ha": "하승운",
  "Sung-Yun Kwon": "권성윤",
  "Seong-Yun Kwon": "권성윤",
  "Jin-Woo Bae": "배진우",
  "Seok-Hwan Jang": "장석환",
  "Young-Kyu Ahn": "안영규",
  "Seung-Kyum Lim": "임승겸",
  "Yong-Hyeok Kim": "김용혁",
  "Bae-Hyeon Gong": "공배현", // 확인 필요
  "Sang-Gi Min": "민상기",
  "Min-Ki Lee": "이민기", // 광주 소속 (파주 소속 동명이인과 별개)
  "Won-Jae Park": "박원재",
  "Se-Jong Ju": "주세종",
  "Kyoung-Rok Choi": "최경록",
  "Je-Ho Yu": "유제호",
  "Jong-Suk Kim": "김종석",
  "Hui-Su Kang": "강희수",
  "Gyu-Min Jung": "정규민",
  "Min-Seo Moon": "문민서",
  "Chang-Moo Shin": "신창무",
  "Chang-Moo Sin": "신창무",
  "Yong-Jun Hong": "홍용준",
  "Ji-Hun Jung": "정지훈",
  "Sung-Hyun Park": "박성현",
  "Woo-Jin Kim": "김우진", // 광주 소속 (화성 소속 동명이인과 별개)
  "Hyeok-Joo Ahn": "안혁주",
  "Yun-Ho Kim": "김윤호",
  "Yong-Jick Lee": "이용직",
  "Yong-Jik Ri": "이용직",

  // ===== ⚽ K리그2 =====

  // --- Suwon Samsung Bluewings (수원 삼성 블루윙즈) ---
  "Hyung-Mo Yang": "양형모",
  "Joon-Hong Kim": "김준홍",
  "Gyung-Jun Lee": "이경준",
  "Jun-Jae Lee": "이준재",
  "Geon-Hee Lee": "이건희",
  "Dong-Yoon Jung": "정동윤",
  "Sung-Hoon Kwak": "곽성훈",
  "Gyeong-Bin Mo": "모경빈",
  "Ju-Hun Song": "송주훈",
  "Jong-Hyun Ko": "고종현",
  "Min-Jun Yeo": "여민준",
  "Seong-Min Geong": "정성민", // 확인 필요 - fotmob 원문 성씨 표기 "Geong"
  "Jeong-Ho Hong": "홍정호",
  "Geun-Yeong Yoon": "윤근영",
  "Hyeon-Seo Han": "한현서",
  "Ji-Mook Choi": "최지묵",
  "Dae-Won Park": "박대원",
  "Ji-Hoon Lim": "임지훈",
  "Ho-Yeon Jeong": "정호연",
  "Hyun-Bin Park": "박현빈",
  "Min-Woo Kim": "김민우",
  "Seung-Beom Ko": "고승범",
  "Ji-Sung Kim": "김지성",
  "Seong-Jin Kang": "강성진",
  "Do-Yeon Kim": "김도연", // 수원삼성 소속 (대전 소속 동명이인과 별개)
  "Seong-Ju Kim": "김성주", // 수원삼성 소속 (천안 소속 동명이인과 별개)
  "Ji-Ho Kim": "김지호", // 수원삼성 소속 (대전 소속 동명이인과 별개)
  "Hyun-Muk Kang": "강현묵",
  "Ji-Hyun Kim": "김지현",
  "Gyeol Kim": "김결",

  // --- Suwon FC (수원 FC) ---
  "Yun-Oh Lee": "이윤오",
  "Min-Ki Jeong": "정민기",
  "Han-Been Yang": "양한빈",
  "Jung-Woo Moon": "문정우",
  "Yeong-Woo Jang": "장영우",
  "Si-Young Lee": "이시영",
  "Jeong-Wan Kim": "김정완",
  "Hyun-Yong Lee": "이현용", // 확인 필요
  "Joon-Ho Hong": "홍준호",
  "Jin-Woo Jo": "조진우",
  "Ji-Sol Lee": "이지솔",
  "Seung-Hwan Baek": "백승환",
  "Yeon-Woo Jang": "장연우",
  "Ji-Hoon Kim": "김지훈", // 수원FC 소속 (안양 소속 동명이인과 별개)
  "Jae-Min Seo": "서재민", // 수원FC 소속 (인천 소속 동명이인과 별개)
  "Yun-Koo Kang": "강윤구", // 수원FC 소속 (강원 소속 동명이인과 별개)
  "Chan-Hee Han": "한찬희",
  "Bon-Cheol Goo": "구본철",
  "Jae-Won Lee": "이재원", // 수원FC 소속 (부천 소속 동명이인과 별개)
  "Do-Hyun Yeom": "염도현",
  "Yun-Ho Jang": "장윤호",
  "Gyeong-Min Kim": "김경민", // 수원FC 소속 (수원삼성 소속 동명이인과 별개)
  "Jun-Gyu Ahn": "안준규",
  "Jeong-Hwan Kim": "김정환",
  "Gi-Yun Choi": "최기윤",
  "Kyung Baek": "백경", // 확인 필요
  "Seung-Bae Jung": "정승배",
  "Ryun-Seong Choe": "최륜성",
  "Jae-Hun Park": "박재훈",
  "Do-Yoon Kim": "김도윤",
  "Jeong-Woo Ha": "하정우",

  // --- Seoul E-Land FC (서울 이랜드 FC) ---
  "Seong-Jun Min": "민성준",
  "Ye-Hoon Ueom": "엄예훈", // 확인 필요
  "Jae-Yun Hwang": "황재윤",
  "In-Pyo Oh": "오인표",
  "Jae-Hwan Park": "박재환",
  "Min-Jae Kang": "강민재",
  "Jin-Young Park": "박진영",
  "Ji-Ung Baek": "백지웅",
  "Oh-Kyu Kim": "김오규",
  "Yeon-Won Jeong": "정연원",
  "Seo-Joon Bae": "배서준",
  "Hyun-Woo Kim": "김현우", // 서울이랜드 소속 (김천 소속 동명이인과 별개)
  "Young-Suk Kang": "강영석",
  "Jin-Seok Seo": "서진석",
  "Joon-Hyeon Jo": "조준현",
  "Suk-Ju Yoon": "윤석주",
  "Chang-Hwan Park": "박창환",
  "Ju-Hwan Kim": "김주환",
  "Rang Choi": "최랑", // 확인 필요
  "Hyeok-Chan Son": "손혁찬",
  "Sun-Woo Park": "박선우",
  "Joo-Hyuk Lee": "이주혁",
  "Joo-Wan Ahn": "안주완",
  "Ahn Joo-Wan": "안주완",
  "Woo-Bin Kim": "김우빈",
  "Hyun Kim": "김현",
  "Hyeon-Je Kang": "강현제",
  "Jae-Yong Bak": "박재용",

  // --- Daegu FC (대구 FC) ---
  "Dong-Min Goh": "고동민",
  "Seong-Su Park": "박성수",
  "Tae-Hee Han": "한태희",
  "Jae-Won Hwang": "황재원",
  "Rim Lee": "이림",
  "Hyun-Tae Jo": "조현태",
  "Joo-Won Kim": "김주원",
  "Kang-San Kim": "김강산",
  "In-Taek Hwang": "황인택",
  "Jung-Woo Byun": "변정우",
  "Ye-Jun Lee": "이예준",
  "Hyeong-Jin Kim": "김형진",
  "Jae-Seok Hong": "홍재석",
  "Sung-Won Jang": "장성원",
  "Kook-Young Han": "한국영",
  "Dae-Woo Kim": "김대우",
  "Jae-Moon Ryu": "류재문",
  "Jong-Mu Han": "한종무",
  "Kwon-Suk Sung": "성권석",
  "Won-Woo Lee": "이원우",
  "Gi-Hyun Park": "박기현",
  "Min-Joon Kim": "김민준",
  "Kang-Min Choi": "최강민",
  "Se-Jin Park": "박세진", // 대구 소속 (김천/충남아산 소속 동명이인과 별개)
  "Ju-Gong Kim": "김주공",
  "Dae-Hoon Park": "박대훈",
  "In-Hyeok Park": "박인혁",

  // --- Busan I'Park (부산 아이파크) ---
  "Sang-Min Koo": "구상민",
  "Yoo-Rae Kim": "김유래",
  "Ji-Min Park": "박지민",
  "An-Ton Song": "송안톤", // 확인 필요
  "Hyun-Beom Ahn": "안현범",
  "Jin-Hyuk Kim": "김진혁",
  "Joo-Seong Woo": "우주성",
  "Hee-Seung Kim": "김희승",
  "Dong-Ryeol Choi": "최동렬",
  "Jun-Seong Kwon": "권준성",
  "Ho-Ik Jang": "장호익",
  "Dong-Jae Cho": "조동재",
  "Sung-Jin Jeon": "전성진", // 부산 소속 (화성 소속 동명이인과 별개)
  "Dong-Wook Kim": "김동욱",
  "Dong-Su Lee": "이동수",
  "Min-Hyeok Kim": "김민혁",
  "Dong-Yoon Kim": "김동윤",
  "Hye-Seong Park": "박혜성", // 확인 필요
  "Jun-Seok Son": "손준석",
  "Se-Hoon Kim": "김세훈",
  "Hyun-Min Kim": "김현민",
  "Hwi Son": "손휘",
  "Ho-Jin Lee": "이호진",
  "Chan Kim": "김찬",
  "Ga-On Baek": "백가온",

  // --- Hwaseong FC (화성 FC) ---
  "Seung-Gun Kim": "김승근",
  "Kim Seung-Gun": "김승근",
  "Ki-Hun Kim": "김기훈",
  "Tae-Jun Kim": "김태준",
  "Eui-Jeong Park": "박의정",
  "Min-Jun Jang": "장민준",
  "Si-Hoo Yang": "양시후",
  "Jun-Seo Park": "박준서",
  "Je-Yul Kim": "김제율",
  "Sung-Jin Kim": "김성진",
  "Sun-Woo Ham": "함선우",
  "Chan-youl Lim": "임찬열",
  "Rae-Jun Lee": "이래준",
  "Jung-Min Kim": "김정민",
  "Seong-Jin Jeon": "전성진", // 화성 소속 (부산 소속 동명이인과 별개)
  "Jae-Seong Park": "박재성",
  "Jong-Sung Lee": "이종성",
  "Myung-Hee Choi": "최명희",
  "Dae-Hwan Kim": "김대환",
  "Yong-hee Jeong": "정용희",
  "Kyung-Min Park": "박경민",
  "Kyeong-Min Park": "박경민",
  "Ye-Hoon Choi": "최예훈",
  "Seung-Beom Son": "손승범",
  "Byeong-Hun Lim": "임병훈",
  "Jae-Min Jegal": "제갈재민", // 확인 필요
  "Woo-Jin Kim": "김우진", // 화성 소속 (광주 소속 동명이인과 별개)
  "Kun-Sung Hwang": "황건성",
  "Ji-Han Lee": "이지한",
  "Beom-Hwan Kim": "김범환",
  "Byong-Oh Kim": "김병오",
  "Byeong-Oh Kim": "김병오",

  // --- Gimpo FC (김포 FC) ---
  "Sang-Min Lee": "이상민", // 김포 소속 (서울/성남 소속 동명이인과 별개)
  "Bo-Sang Yoon": "윤보상",
  "Jeong-Hyeon Son": "손정현",
  "Sun-Gyu Choi": "최선규",
  "Kyung-Rok Park": "박경록",
  "Tae-Han Kim": "김태한",
  "Chan-Hyung Lee": "이찬형",
  "Sang-Hyun Park": "박상현",
  "In-Jae Lee": "이인재",
  "Tae-Hyeong Hong": "홍태형",
  "Jong-Woon Choi": "최종운",
  "Yong-Hyeok Lee": "이용혁",
  "Dong-Min Kim": "김동민", // 김포 소속 (용인 소속 동명이인과 별개)
  "Byung-Hyun Park": "박병현",
  "Jae-Young Choi": "최재영",
  "Do-Hyeok Kim": "김도혁",
  "Sung-Joon Kim": "김성준",
  "Hak-Min Lee": "이학민",
  "Chang-Seok Lim": "임창석",
  "Jae-Woon Yoon": "윤재운",
  "Sung-Bum Choi": "최성범",
  "Min-Seok Kim": "김민석", // 김포 소속 (전남 소속 동명이인과 별개)
  "Min-Sik Kim": "김민식",
  "Bu-Seong Jang": "장부성",
  "Si-Heon Lee": "이시헌",
  "Hyeon-U Nam": "남현우",
  "Dong-Jin Park": "박동진",

  // --- Chungnam Asan FC (충남 아산 FC) ---
  "Song-Hoon Shin": "신송훈",
  "Jin-Young Kim": "김진영",
  "Ju-Hwan Seo": "서주환",
  "Seong-Woo Park": "박성우",
  "Se-Jin Park": "박세진", // 충남아산 소속 (김천/대구 소속 동명이인과 별개)
  "Ho-In Lee": "이호인",
  "Jun-Young Byun": "변준영",
  "Hee-Won Choi": "최희원",
  "Seung-Uk Yang": "양승욱",
  "Bo-Kyung Choi": "최보경",
  "Hye-Seong Kim": "김혜성", // 확인 필요
  "Hyun-Woung Choi": "최현웅",
  "Ye-Jun Jeong": "정예준",
  "Jun-Young Jang": "장준영",
  "Ju-Sung Kim": "김주성",
  "Se-Jun Jung": "정세준",
  "Chi-Won Choi": "최치원",
  "Jun-Ho Son": "손준호",
  "Young-Nam Kim": "김영남",
  "Se-Jik Park": "박세직",
  "Je-Hee Yoon": "윤제희",
  "Il-Yeon Sin": "신일연",
  "Jong-Min Park": "박종민",
  "Min-Ho Kim": "김민호", // 충남아산 소속 (파주 소속 동명이인과 별개)
  "Woo-Jae Jeong": "정우재",
  "Kyo-Won Han": "한교원",
  "Ju-Young Park": "박주영", // 확인 필요
  "Mun-Gyeong Sung": "성문경", // 확인 필요 - fotmob 표기 순서 특이
  "Jong-Min Kim": "김종민", // 충남아산 소속 (부천 소속 동명이인과 별개)

  // --- Gyeongnam FC (경남 FC) ---
  "Jun-Seo Shin": "신준서",
  "Ki-Hyun Lee": "이기현",
  "Gi-Hyeon Lee": "이기현",
  "Ho-Jin An": "안호진",
  "Bum-Soo Lee": "이범수",
  "Tae-Hoon Kim": "김태훈",
  "Ho-Jun Son": "손호준",
  "Woo-Young Cho": "조우영",
  "Seong-Jin Choi": "최성진",
  "Seong-Hun Choe": "최성훈",
  "Kyu-Min Kim": "김규민", // 경남 소속 (부천 소속 동명이인과 별개)
  "Gyu-Baek Lee": "이규백",
  "Hyeong-Won Kim": "김형원",
  "Jung-Won Choi": "최정원",
  "Hyun-Wook Jung": "정현욱",
  "Yeon-Soo Kim": "김연수", // 경남 소속 (인천 소속 동명이인과 별개)
  "Seung-Woo Jang": "장승우",
  "Eun-Su Lim": "임은수",
  "Chan-Dong Lee": "이찬동",
  "Sun-Ho Kim": "김선호",
  "Hyun-Seo Bae": "배현서",
  "Hyun-Sub Lim": "임현섭",
  "Gi-Pyo Kwon": "권기표",
  "Ki-Pyo Kwon": "권기표",
  "Jun-Ho Kim": "김준호",
  "Jung-Hyeon Kim": "김정현",
  "Jeong-Hyun Kim": "김정현",
  "Ha-Min Kim": "김하민",
  "Min-Su Jeon": "전민수",
  "Il-Lok Yun": "윤일록",
  "Sang-Jun Cho": "조상준",
  "Jin-Hyuk Cho": "조진혁",
  "Heon-Jae Lee": "이헌재",
  "Hyeon-Oh Kim": "김현오",
  "Jung-Min Lee": "이정민",

  // --- Seongnam FC (성남 FC) ---
  "Gwang-Yeon Lee": "이광연",
  "Myeong-Jae Jeong": "정명재",
  "Jae-Min Ahn": "안재민", // 성남 소속 (서울 소속 동명이인과 별개)
  "Ju-An You": "유주안",
  "Byeong-Jun Kwon": "권병준",
  "Ji-Hun Lee": "이지훈",
  "Min-Jun Yoo": "유민준",
  "Young-Han Kim": "김영한",
  "Sun Yu": "유선", // 확인 필요
  "Seung-Yong Jung": "정승용",
  "Jun-Sun Ryu": "류준수",
  "Byeong-Gyu Park": "박병규",
  "Jae-Wook Lee": "이재욱",
  "Seok-Ki Hwang": "황석기",
  "Jeong-Bin Lee": "이정빈",
  "Jun-Sang Lee": "이준상",
  "Tae-Yang Yang": "양태양",
  "Min-Gyu Jeon": "전민규",
  "Chang-Beom Hong": "홍창범",
  "Min-Jae Kim": "김민재", // 성남 소속 (안산 소속 동명이인과 별개)
  "Sang-Hyeok Park": "박상혁", // 성남 소속 (강원 소속 동명이인과 별개)
  "Min-Ho Yun": "윤민호",

  // --- Paju Frontier (파주 프론티어) ---
  "Won-Woo Ryu": "류원우",
  "Min-Seung Kim": "김민승",
  "Jun-Mo Hwang": "황준모",
  "Kyung-Min Yeom": "염경민",
  "Seung-Ik Noh": "노승익",
  "Noh Seung-Ik": "노승익",
  "Hyun-Tae Kim": "김현태",
  "Min-Yong Sim": "심민용",
  "Hyeon-Byung Jeon": "전현병", // 확인 필요
  "Yeon-gyu Lee": "이연규",
  "Jung-Hyun Seo": "서정현",
  "Min-Ho Kim": "김민호", // 파주 소속 (충남아산 소속 동명이인과 별개)
  "Yu-Sang Jeon": "전유상",
  "Min-Sung Kim": "김민성",
  "Min-Ki Lee": "이민기", // 파주 소속 (광주 소속 동명이인과 별개)
  "Taek-Geun Lee": "이택근",
  "Bum-Kyung Choi": "최범경",
  "Beom-Kyung Choi": "최범경",
  "Jeong-Woon Hong": "홍정운",
  "Jung-Woon Hong": "홍정운",
  "Je-Ho Lee": "이제호",
  "Jea-Ho Lee": "이제호",
  "Sang-Yoon Choi": "최상윤",
  "Chan-Ho Lee": "이찬호",
  "Dong-Yeol Lee": "이동열",
  "Dong-Han Seo": "서동한",
  "Dae-Kwang Lee": "이대광",
  "Su-Bin Park": "박수빈", // 파주 소속 (제주 소속 동명이인과 별개)
  "Jae-Jun Yu": "유재준",
  "Joon-Suk Lee": "이준석",
  "Jun-Seok Lee": "이준석",
  "Won-Rok Choi": "최원록",
  "Jin-Young Sung": "성진영",
  "June-Hyuk Ahn": "안준혁", // 확인 필요 - fotmob 표기 순서 반대

  // --- Yongin FC (용인 FC) ---
  "Hee-Dong Roh": "노희동",
  "Sung-Min Hwang": "황성민",
  "Min-Jun Kim": "김민준", // 용인 소속 (서울/부천 소속 동명이인과 별개)
  "Sin-Myeong Kang": "강신명",
  "Hyun-Woo Cho": "조현우", // 용인 소속 (울산 소속 동명이인과 별개)
  "Yun-Ho Kwak": "곽윤호",
  "Hyeong-Jin Lim": "임형진",
  "Hyeon-Jun Kim": "김현준",
  "Chai-Min Lim": "임채민",
  "Jin-Seop Lee": "이진섭",
  "Jae-Jun Lee": "이재준",
  "Min-Woo Kim": "김민우", // 용인 소속 (수원삼성 소속 동명이인과 별개)
  "Jae-Hun Cho": "조재훈",
  "Jae-Hyung Lee": "이재형",
  "Young-Jun Choi": "최영준",
  "Jin-Ho Kim": "김진호", // 용인 소속 (김천 소속 동명이인과 별개)
  "Han-Seo Kim": "김한서",
  "Dong-Min Kim": "김동민", // 용인 소속 (김포 소속 동명이인과 별개)
  "Han-Gil Kim": "김한길",
  "Tae-Ho Jin": "진태호",
  "Kyu-Dong Lee": "이규동",
  "Bo-Sub Kim": "김보섭",
  "Dong-Gyu Yu": "유동규",
  "Jin-Ho Shin": "신진호",
  "Hyun-Jun Suk": "석현준",
  "Chi-Ung Choi": "최치웅",

  // --- Cheongju FC (청주 FC) ---
  "Dong-Geon No": "노동건", // 청주 소속 (전남 소속 동명이인과 별개)
  "Sung-Hoon Cho": "조성훈",
  "Seong-Been Cho": "조성빈",
  "Tae-Yoon Gong": "공태윤",
  "Seung-Hwan Lee": "이승환",
  "Kang-Han Lee": "이강한",
  "Yun-Seong Jo": "조윤성",
  "Ju-Yeong Jo": "조주영",
  "Ju-Young Jo": "조주영",
  "Suk-Young Yun": "윤석영",
  "Yun-Hwan Kim": "김윤환",
  "Eui-Bin Kang": "강의빈",
  "Chang-Hoon Lee": "이창훈",
  "Keon-Woo Bak": "박건우",
  "Geon-Woo Park": "박건우",
  "Seon-Min Kim": "김선민",
  "Sun-Min Kim": "김선민",
  "Seung-Chan Heo": "허승찬",
  "Jin-Woo Jeong": "정진우",
  "Na-Moo Ju": "주나무",
  "Dong-Jin Lee": "이동진",
  "Ji-Hoon Min": "민지훈",
  "Dong-Won Lee": "이동원",
  "Jae-Won Seo": "서재원",
  "Seok-Jun Hong": "홍석준",
  "Sung-Dong Paik": "백성동",
  "Du-Hyun Kim": "김두현",
  "Jong-Eon Lee": "이종언",
  "Young-Been Yang": "양영빈",
  "Yoon-Hwan Lee": "이윤환",
  "Chang-Seok Song": "송창석",

  // --- Cheonan City (천안 시티 FC) ---
  "Ju-Won Park": "박주원",
  "Dae-Han Park": "박대한",
  "Seung-Kyu Lee": "이승규",
  "Kwang-Jun Lee": "이광준",
  "Tae-Won Go": "고태원",
  "Kyu-Baek Choi": "최규백",
  "Hyun-Do Jang": "장현도",
  "Seong-Ju Kim": "김성주", // 천안 소속 (수원삼성 소속 동명이인과 별개)
  "Sang-Yong Lee": "이상용",
  "Yong-Seung Kwon": "권용승",
  "Kyo-Hoon Kang": "강교훈",
  "Ji-Hwang Jeong": "정지황",
  "Seung-Hyeon Cha": "차승현",
  "Jun-Hyeok Choi": "최준혁",
  "Dong-Min Her": "허동민",
  "Ji-Seung Lee": "이지승",
  "Ui-Jun Jin": "진의준",
  "Jae-Min Ha": "하재민",
  "Ji-Hoon Lee": "이지훈",
  "Chang-Woo Park": "박창우",
  "Gyu-Min Lee": "이규민",
  "Dong-Hyeop Lee": "이동협",
  "Sang-Jun Lee": "이상준",
  "Jong-Uk Koo": "구종욱",
  "Eun-Gyul Eo": "어은결",
  "Jun-Ho Lee": "이준호",
  "Chang-Min An": "안창민",
  "Jeong-Yeon Wu": "우정연",

  // --- Ansan Greeners (안산 그리너스) ---
  "Seung-Bin Lee": "이승빈",
  "Do-Dam Kim": "김도담",
  "Min-Jae Kim": "김민재", // 안산 소속 (성남 소속 동명이인과 별개)
  "Jei-Min Yeon": "연제민",
  "Eung-Bin Yeon": "연응빈",
  "Beom Song": "송범",
  "Hyo-Jun Lee": "이효준",
  "Ji-Min Rim": "임지민",
  "Kyu-Min Park": "박규민",
  "Hyun-Woo Jeong": "정현우",
  "Geon-Oh Kim": "김건오",
  "Ji-Hun Cho": "조지훈",
  "Jung-Hyun Kim": "김정현", // 안산 소속 (안양 소속 동명이인과 별개)
  "Seung-Hyun Kim": "김승현",
  "Dan Choi": "최단",
  "Seung-Woo Do": "도승우",
  "Dong-Hyun Kang": "강동현",
  "Seung-Wan Ryu": "류승완",
  "In-Sung Kim": "김인성",
  "Hyun-Soo Jang": "장현수",
  "Gyu-Bin Lee": "이규빈",
  "Seung-Woo Ryu": "류승우",
  "Jun-Hyeok Park": "박준혁",
  "Ho-Jin Jin": "진호진",
  "Jae-Hwan Lee": "이재환",
  "Geon-Wook Jeong": "정건욱",
  "Jun-Han Lee": "이준한",
  "Baek-Min Kim": "김백민",
  "Chae-Jun Park": "박채준",

  // --- Jeonnam Dragons (전남 드래곤즈) ---
  "Bong-Jin Choi": "최봉진",
  "Bong Jin Choi": "최봉진",
  "Min-Hyeop Jo": "조민협",
  "Jun-Hee Lee": "이준희",
  "Ju-Yeop Kim": "김주엽",
  "Joo-Heon Kim": "김주헌",
  "Ji-Ha Yoo": "유지하",
  "Hyun-Jun Ku": "구현준",
  "Soon-Hyeok Jang": "장순혁",
  "Han-Sol Choi": "최한솔",
  "Song Ho": "호송", // 확인 필요
  "Seok-Hyeon Hong": "홍석현",
  "Gyeong-Jae Kim": "김경재",
  "Dong-Geon Noh": "노동건", // 전남 소속 (청주 소속 동명이인과 별개)
  "Jun-Yeong Min": "민준영",
  "Kwang-Hyun Ryu": "류광현",
  "Tae-In Jung": "정태인",
  "Tae-Yong Park": "박태용",
  "Min-Ho Yoon": "윤민호",
  "Ji-San Yang": "양지산",
  "Sang-Hun Chu": "추상훈",
  "Young-Kwang Cho": "조영광", // 전남 소속 (김해 소속 동명이인과 별개)
  "Beom-Su Kim": "김범수",
  "Gun-Ho Son": "손건호",
  "Ji-Yong Jeong": "정지용",
  "Min-Seok Kim": "김민석", // 전남 소속 (김포 소속 동명이인과 별개)
  "Nam Ha": "하남",
  "Kyung-Jun Kim": "김경준",
  "Kang-Min Jung": "정강민",

  // --- Gimhae FC 2008 (김해 FC 2008) ---
  "Jin-Wook Jeong": "정진욱",
  "Jun-Sung Han": "한준성",
  "Pil-Su Choe": "최필수",
  "Yo-Han Park": "박요한",
  "Jun-young Cha": "차준영",
  "Jae-Yul Yeo": "여재율",
  "Jun-Yeong Choi": "최준영",
  "Hyeon-Deok Kim": "김현덕",
  "Dae-Hyeon Kim": "김대현",
  "Uk-Hyeon Hong": "홍욱현",
  "Dong-Gook Kim": "김동국",
  "Byung-Kwon Yoon": "윤병권",
  "Kyung-Soo Kim": "김경수",
  "Jae-Hyun Park": "박재현",
  "Geon-Hee Pyo": "표건희",
  "Seung-Min Moon": "문승민",
  "Won-Chul Choi": "최원철",
  "Sang-Jun Park": "박상준",
  "Hyung-Bin Park": "박형빈",
  "Seong-Uk Gwak": "곽성욱",
  "Seul-Chan Lee": "이슬찬",
  "Kang-Uk Lee": "이강욱",
  "Yu-Chan Lee": "이유찬",
  "Hyeon-Jin Seol": "설현진",
  "Young-Kwang Cho": "조영광", // 김해 소속 (전남 소속 동명이인과 별개)
  "Ho-Yeung Sung": "성호영",
  "Jun-Gyu Lee": "이준규",
  "Joon-Mo Kang": "강준모",
  "Se-Jin Myung": "명세진",
  "Seung-Jae Lee": "이승재",
  "Je-Wook Woo": "우제욱",

  // ===== 🔄 Surname GivenName 순서 표기 (통합 라인업 위젯, 2026-08 확인) =====
  // 아산 무궁화 vs 용인 FC 라인업 위젯에서 이름이 "Surname GivenName" 순서로
  // 나온 게 확인됨(기존 key들은 전부 "GivenName Surname" 순서). 아산 무궁화 쪽
  // 선수 8명은 충남아산 FC 기존 등록 선수와 이름이 동일함(같은 팀의 다른 표기로 추정).
  // 외국인 선수(Charles Lokolingoy, Gabriel Tigrão, Jardel)는 매핑 대상 아님.
  "Shin Song-Hoon": "신송훈", // 아산 무궁화(충남아산FC) — 신규
  "Byun Jun-Young": "변준영", // 충남아산FC 기존 "Jun-Young Byun"과 동일 인물
  "Kim Hye-Seong": "김혜성", // 충남아산FC 기존 "Hye-Seong Kim"과 동일 인물 // 확인 필요
  "Jang Jun-Young": "장준영", // 충남아산FC 기존 "Jun-Young Jang"과 동일 인물
  "Park Seong-Woo": "박성우", // 충남아산FC 기존 "Seong-Woo Park"과 동일 인물
  "Jung Se-Jun": "정세준", // 충남아산FC 기존 "Se-Jun Jung"과 동일 인물
  "Son Jun-Ho": "손준호", // 충남아산FC 기존 "Jun-Ho Son"과 동일 인물
  "Kim Ju-Sung": "김주성", // 충남아산FC 기존 "Ju-Sung Kim"과 동일 인물
  "Han Kyo-Won": "한교원", // 충남아산FC 기존 "Kyo-Won Han"과 동일 인물
  "Park Ju-Young": "박주영", // 충남아산FC 기존 "Ju-Young Park"과 동일 인물 // 확인 필요
  "Hwang Sung-Min": "황성민", // 용인FC 기존 "Sung-Min Hwang"과 동일 인물
  "Yu Dong-Gyu": "유동규", // 용인FC 기존 "Dong-Gyu Yu"과 동일 인물
  "Choi Young-Jun": "최영준", // 용인FC 기존 "Young-Jun Choi"과 동일 인물
  "Kim Hyeon-Jun": "김현준", // 용인FC 기존 "Hyeon-Jun Kim"과 동일 인물
  "Kang Sin-Myeong": "강신명", // 용인FC 기존 "Sin-Myeong Kang"과 동일 인물
  "Kim Han-Gil": "김한길", // 용인FC 기존 "Han-Gil Kim"과 동일 인물
  "Kim Han-Seo": "김한서", // 용인FC 기존 "Han-Seo Kim"과 동일 인물
  "Kwak Yun-Ho": "곽윤호", // 용인FC 기존 "Yun-Ho Kwak"과 동일 인물
  "Kim Jin-Ho": "김진호", // 용인 소속 (김천 소속 동명이인과 별개) — 기존 "Jin-Ho Kim"과 동일 인물

  // ===== 🎽 감독 (한국 국적만, K리그1+K리그2) =====
  // 외국인 감독(Jeju SK: Sergio Costa, Chungnam Asan: André, Paju Frontier:
  // Gerard Nus, Cheongju FC: Rui Quinta)은 제외. Seongnam FC는 조회 시점에 fotmob
  // 스쿼드 페이지에 감독 항목 자체가 없어서 비워둠 — 나중에 뜨면 같은 방식
  // (GivenName Surname)으로 추가하면 됨.

  "Gi-Dong Kim": "김기동", // FC 서울
  "Moon-Shik Choi": "최문식", // 안산 그리너스
  "Choi Moon-Shik": "최문식", // 안산 그리너스
  "Hyun-Seok Kim": "김현석", // 울산 HD — fotmob 스쿼드 페이지에서 이 항목만 이미 GivenName Surname 순서였음
  "Jung-Yong Chung": "정정용", // 전북 현대
  "Jung-Yong Jung": "정정용", // 전북 현대
  "Jeong-Yong Jung": "정정용", // 전북 현대
  "Kyeong-Ho Chung": "정경호", // 강원 FC
  "Kyung-Ho Chung": "정경호", // 강원 FC
  "Tae-Ha Park": "박태하", // 포항 스틸러스
  "Byeong-Hoon Ryu": "류병훈", // FC 안양
  "Jong-Hwan Yoon": "윤정환", // 인천 유나이티드
  "Young-Min Lee": "이영민", // 부천 FC 1995
  "Sun-Hong Hwang": "황선홍", // 대전 하나 시티즌
  "Seung-jin Joo": "주승진", // 김천 상무
  "Seung-Jin Ju": "주승진", // 김천 상무
  "Jeong-Gyu Lee": "이정규", // 광주 FC
  "Jeong-Kyu Lee": "이정규", // 광주 FC
  "Jung-Hyo Lee": "이정효", // 수원 삼성 블루윙즈
  "Kun-Ha Park": "박건하", // 수원 FC
  "Do-Kyun Kim": "김도균", // 서울 이랜드 FC
  "Kim Do-Kyun": "김도균", // 서울 이랜드 FC
  "Sung-Yong Choi": "최성용", // 대구 FC
  "Sung-Hwan Jo": "조성환", // 부산 아이파크
  "Du-Ri Cha": "차두리", // 화성 FC
  "Cha Du-Ri": "차두리", // 화성 FC
  "Jeong-Woon Ko": "고정운", // 김포 FC
  "Sung-Jae Bae": "배성재", // 경남 FC
  "Bae Sung-Jae": "배성재", // 경남 FC
  "Yun-Kyum Choi": "최윤겸", // 용인 FC
  "Choi Yun-Kyum": "최윤겸", // 용인 FC
  "Jin-Sub Park": "박진섭", // 천안 시티 FC
  "Kwan-Sik Lim": "임관식", // 전남 드래곤즈
  "Lim Kwan-Sik": "임관식", // 전남 드래곤즈
  "Hyun-Joon Son": "손현준", // 김해 FC 2008

  // ===== 🌍 해외파 (유럽/북미 등 해외 리그 진출 선수, 2026-08 조사 기준) =====
  // 국가대표 경기, 전력분석 본문 등에 이름이 등장할 때 매핑됨.
  // 김민재(바이에른 뮌헨), 고영준(구르니크 자브제)은 기존 K리그 항목의 값이
  // 이미 동일한 한글이라 별도 등록 불필요.
  "Seung-Ho Paik": "백승호", // 버밍엄 시티 (잉글랜드)
  "Heung-Min Son": "손흥민", // LAFC (미국)
  "Kang-In Lee": "이강인", // 파리 생제르맹 (프랑스)
  "Hee-Chan Hwang": "황희찬", // 울버햄튼 (잉글랜드)
  "Jae-Sung Lee": "이재성", // 마인츠 05 (독일)
  "In-Beom Hwang": "황인범", // 페예노르트 (네덜란드)
  "Jun-Ho Bae": "배준호", // 스토크 시티 (잉글랜드)
  "Hyun-Jun Yang": "양현준", // 셀틱 (스코틀랜드)
  "Young-Woo Seol": "설영우", // 츠르베나 즈베즈다 (세르비아)
  "Han-Beom Lee": "이한범", // 미트윌란 (덴마크)
  "Ji-Soo Kim": "김지수", // 카이저슬라우테른 (독일)
  "Kang-Hee Lee": "이강희", // FK 아우스트리아 빈 (오스트리아)
  "Tae-Seok Lee": "이태석", // FK 아우스트리아 빈 (오스트리아)
  "Min-Woo Kang": "강민우", // KRC 헹크 (벨기에)
  "Hyeon-Gyu Oh": "오현규", // KRC 헹크 (벨기에)
  "Hyeok-Kyu Kwon": "권혁규", // FC 낭트 (프랑스)
  "Hyun-Seok Hong": "홍현석", // FC 낭트 (프랑스)
  "Woo-Yeong Jeong": "정우영", // 1.FC 우니온 베를린 (독일)
  "Woo-Yeong Jung": "정우영", // 1.FC 우니온 베를린 (독일) — Jeong/Jung 표기 혼용 대비
  "Ji-Sung Eom": "엄지성", // 스완지 시티 (웨일스)
  "Min-Hyeok Yang": "양민혁", // 포츠머스 (잉글랜드, 지로나 임대)
  "Gue-Sung Cho": "조규성", // 미트윌란 (덴마크)
  "Gue-Sung Jo": "조규성", // 미트윌란 (덴마크) — Cho/Jo 표기 혼용 대비
  "Seung-Soo Park": "박승수", // 뉴캐슬 유나이티드 (잉글랜드)
  "Do-Young Yoon": "윤도영", // 엑셀시오르 (네덜란드, 브라이튼 원소속 임대)
  "Do-Young Yun": "윤도영", // 엑셀시오르 (네덜란드, 브라이튼 원소속 임대) — Yoon/Yun 표기 혼용 대비
  "Seung-Gyun Bae": "배승균", // 페예노르트 유스팀 (네덜란드) // 확인 필요 - 로마자 표기 불확실

};

export default PLAYER_NAME_MAP;