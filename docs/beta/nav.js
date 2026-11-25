// 시험판 공통 아래 메뉴 — 각 화면에 <script src="nav.js"></script> 한 줄로 붙임
(function () {
  const items = [
    ["home.html", "서울 지도", '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>'],
    ["./", "생활권", '<path d="M4 19V5M4 19h16"/><path d="m7 15 4-4 3 3 5-6"/>'],
    ["group.html", "시세 그룹", '<rect x="3" y="4" width="7" height="7" rx="1.5"/><rect x="14" y="4" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'],
    ["cycle.html", "상승·하락", '<path d="M3 17 9 9l4 5 8-10"/><path d="M15 4h6v6"/>'],
    ["mine.html", "내 집", '<path d="M4 11 12 4l8 7"/><path d="M6 10v10h12V10"/><path d="M10 20v-5h4v5"/>'],
  ];
  const here = location.pathname.split("/").pop() || "./";
  const isIdx = here === "" || here === "./" || here === "index.html";
  const nav = document.createElement("nav");
  nav.className = "bnav";
  nav.setAttribute("aria-label", "메뉴");
  nav.innerHTML = '<div class="in">' + items.map(([href, t, ic]) => {
    const on = href === "./" ? isIdx : here === href;
    return `<a href="${href}" class="${on ? "on" : ""}"${on ? ' aria-current="page"' : ""}><svg viewBox="0 0 24 24">${ic}</svg>${t}</a>`;
  }).join("") + "</div>";
  if (!document.querySelector('link[href^="x.css"]')) {   // 생활권 그래프 화면처럼 x.css가 없는 곳에서도 메뉴 모양만은 보이게
    const st = document.createElement("style");
    st.textContent = `.bnav{position:fixed;left:0;right:0;bottom:0;z-index:50;background:rgba(255,255,255,.96);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-top:1px solid #e6e8eb;padding:4px 4px calc(4px + env(safe-area-inset-bottom))}
.bnav .in{max-width:720px;margin:0 auto;display:flex}
.bnav a{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:5px 0 3px;color:#8b9199;text-decoration:none;font-size:11px;font-weight:600;font-family:"Pretendard","Noto Sans KR","Apple SD Gothic Neo",system-ui,sans-serif}
.bnav a svg{width:22px;height:22px;stroke:currentColor;fill:none;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
.bnav a.on{color:#1d1f23}.bnav a.on svg{stroke:#2a6fdb}
body.has-bnav{padding-bottom:calc(64px + env(safe-area-inset-bottom))}
body.has-bnav .toast{bottom:calc(80px + env(safe-area-inset-bottom))}`;
    document.head.appendChild(st);
  }
  const add = () => { document.body.appendChild(nav); document.body.classList.add("has-bnav"); };
  if (document.body) add(); else document.addEventListener("DOMContentLoaded", add);
})();
