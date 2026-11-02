// The onboarding guide, served by the deploy it describes.
//
// Same reason docs.ts exists rather than a README: a guide that ships inside the
// image cannot drift from the buttons it names. guide.test.ts holds it to that --
// rename a button in portal.ts and the assertions there fail.
//
// Both languages are rendered server-side and toggled with a class, rather than
// swapped by client-side templating. It costs some markup and buys two things: the
// page is complete before any script runs, and a test can read both languages out
// of one call to page().
//
// The order is the whole point. Two of the four tools have no control anywhere on
// the home screen -- reportRow() in portal.ts only draws "People +" and "Ads
// research" once a company dossier has finished -- so a user who does not know the
// chain never finds them. The chain diagram comes before the prose for that reason.

import { CLIENT_NAV, navHtml } from './nav.ts';

interface Step {
  no: string;
  name: string;
  lede: string;
  need: string;
  path: string[];
  back: string;
  next: string;
  watch: string;
}

interface Copy {
  lang: string;
  eyebrow: string;
  title: string;
  intro: string;
  chainHead: string;
  chainNeed: string[];
  needLabel: string;
  pathLabel: string;
  backLabel: string;
  nextLabel: string;
  watchLabel: string;
  steps: Step[];
  knowHead: string;
  know: string[];
  openPortal: string;
}

const EN: Copy = {
  lang: 'en',
  eyebrow: 'How this workspace works',
  title: 'Four tools. One chain.',
  intro: 'Read this once. Two of the four tools have no button on the home screen — they only appear after an earlier one has finished, so knowing the order is most of the job.',
  chainHead: 'The order',
  chainNeed: ['Start here', 'Start here, or from a row in 01', 'Needs 02 finished', 'Needs 02 finished'],
  needLabel: 'You need first',
  pathLabel: 'Where to click',
  backLabel: 'What comes back',
  nextLabel: 'Then what',
  watchLabel: 'Watch out',
  steps: [
    {
      no: '01',
      name: 'Business list',
      lede: 'Scan a market on Google Maps and get a ranked list of businesses with their contact points.',
      need: 'Nothing.',
      path: [
        'Home → <b>Business list</b>',
        'Type a kind of business, a location, or both',
        'Pick how many results: 100 / 200 / 300',
        'Press <b>Search market</b>',
      ],
      back: 'A numbered list: name, category, rating, address, phone, website and a Maps link.',
      next: 'Every row carries a <b>Deep research →</b> button — that is tool 02. You can also just call the number or open the website.',
      watch: 'Business or location — either one alone is fine, but not both empty. A bigger result count takes longer.',
    },
    {
      no: '02',
      name: 'Company research',
      lede: 'An evidence-guarded dossier on one company: contacts, the people who run it, and dated business signals.',
      need: 'Nothing — but the company has to be matched to the right Google Maps listing first.',
      path: [
        '<b>From a business list:</b> press <b>Deep research →</b> on that company’s row.',
        '<b>Or from the home screen:</b> Home → <b>Company research</b> → type the name (location optional) → <b>Find company</b> → pick the correct listing → <b>Deep research →</b>',
      ],
      back: 'A company dossier: contact points, validated people, and business signals with dates.',
      next: 'This dossier is what unlocks 03 and 04. Once it finishes, its row under <b>Reports</b> grows two new buttons: <b>People +</b> and <b>Ads research →</b>.',
      watch: 'A status of <b>partial</b> is not a failure — it means part of the evidence came back and the report is usable. This is the slowest of the four.',
    },
    {
      no: '03',
      name: 'VIP brief',
      lede: 'A public-professional brief on one named person inside that company.',
      need: 'A company dossier from 02 that reads <b>completed</b> or <b>partial</b>.',
      path: [
        'Go to <b>Reports</b>',
        'Find the company dossier and press <b>People +</b>',
        'Pick someone under <b>Validated people</b>',
        'Press <b>VIP brief →</b>',
      ],
      back: 'Public professional facts about that person, plus dated signals worth opening a conversation with.',
      next: 'The brief gets its own permanent link and appears under the <b>VIP briefs</b> filter in Reports.',
      watch: 'The People panel holds two lists. Only <b>Validated people</b> have a button. <b>Leads to verify</b> are names a public source attached to the company without evidence of the role — confirm the role yourself first. Sources are Facebook, Instagram and Threads, plus X content reached through Grok; the system never opens x.com directly. A link is only proven if the report marks it <b>cited</b>.',
    },
    {
      no: '04',
      name: 'Ads research',
      lede: 'What the company is actually advertising right now, across the Facebook and Google ad libraries.',
      need: 'A company dossier from 02 that reads <b>completed</b> or <b>partial</b>.',
      path: [
        'Go to <b>Reports</b>',
        'Find the company dossier row',
        'Press <b>Ads research →</b>',
      ],
      back: 'The ads that were found, with their creative images, per network.',
      next: 'It lands under the <b>Ads</b> filter in Reports on its own permanent link.',
      watch: 'If the capture machine at home is offline the report comes back <b>failed</b>. That means nothing was captured — it does <b>not</b> mean the company runs no ads. Never read one as the other.',
    },
  ],
  knowHead: 'Five things worth knowing',
  know: [
    '<b>Your access key is typed once.</b> It stays in this browser, survives new tabs, and is never part of a report link. <b>Sign out</b> clears it.',
    '<b>Nothing makes you wait.</b> Every run happens in the background and the report link exists the moment you press the button. Close the tab if you like — <b>Active work</b> picks it up again.',
    '<b>Four statuses:</b> <span class="pulse"></span><b>running</b>, <b>completed</b>, <b>partial</b> (usable), <b>failed</b>.',
    '<b>Report links are permanent.</b> Safe to bookmark, safe to send to someone without an access key.',
    '<b>Delete cannot be undone.</b> The link stops working, the research data goes, and a run still going is killed with it.',
  ],
  openPortal: 'Open the workspace →',
};

const ZH: Copy = {
  lang: 'zh',
  eyebrow: '这个系统怎么用',
  title: '四个工具，一条顺序。',
  intro: '看一遍就够。四个工具里有两个在首页上根本没有按钮 —— 它们要等前一个跑完才会出现，所以搞清楚顺序，事情就成了一半。',
  chainHead: '顺序',
  chainNeed: ['从这里开始', '从这里开始，或从 01 的某一行进入', '需要 02 先跑完', '需要 02 先跑完'],
  needLabel: '前置条件',
  pathLabel: '点哪里',
  backLabel: '会得到什么',
  nextLabel: '然后呢',
  watchLabel: '注意',
  steps: [
    {
      no: '01',
      name: '商家名单',
      lede: '在 Google 地图上扫描一个市场，得到一份带联系方式的商家名单。',
      need: '没有前置条件。',
      path: [
        '首页 → <b>Business list</b>',
        '填写行业、地点，或两者都填',
        '选择数量：100 / 200 / 300',
        '按 <b>Search market</b>',
      ],
      back: '一份编号名单：名称、类别、评分、地址、电话、网站和地图链接。',
      next: '每一行都带一个 <b>Deep research →</b> 按钮，那就是工具 02。也可以直接打电话或打开对方网站。',
      watch: '行业和地点只填一个也可以，但不能两个都空。数量选得越大，跑得越久。',
    },
    {
      no: '02',
      name: '公司深度研究',
      lede: '针对一家公司的证据型档案：联系方式、经营团队，以及带日期的经营动向。',
      need: '没有前置条件 —— 但公司必须先在 Google 地图上对上正确的那一家。',
      path: [
        '<b>从商家名单进入：</b>在那家公司那一行按 <b>Deep research →</b>。',
        '<b>或从首页进入：</b>首页 → <b>Company research</b> → 输入公司名称（地点可填可不填）→ <b>Find company</b> → 从匹配结果里选中正确的那一家 → <b>Deep research →</b>',
      ],
      back: '一份公司档案：联系方式、已验证的人物，以及带日期的经营信号。',
      next: '这份档案是 03 和 04 的前提。跑完之后，它在 <b>Reports</b> 里的那一行会多出两个按钮：<b>People +</b> 和 <b>Ads research →</b>。',
      watch: '状态显示 <b>partial</b> 不代表失败，而是「拿到了一部分证据，报告可以用」。四个工具里它最花时间。',
    },
    {
      no: '03',
      name: 'VIP 人物简报',
      lede: '针对该公司内某一个人的公开职业简报。',
      need: '一份状态为 <b>completed</b> 或 <b>partial</b> 的 02 公司档案。',
      path: [
        '进入 <b>Reports</b>',
        '找到那份公司档案，按 <b>People +</b>',
        '在 <b>Validated people</b> 里选一个人',
        '按 <b>VIP brief →</b>',
      ],
      back: '这个人的公开职业事实，以及适合作为开场话题的、带日期的动向。',
      next: '简报有自己的永久链接，并会出现在 Reports 的 <b>VIP briefs</b> 筛选里。',
      watch: '人物面板里有两份名单。只有 <b>Validated people</b> 才有按钮。<b>Leads to verify</b> 是公开来源把名字和公司挂上了、但职位还没有证据的线索，请先自行确认职位。资料来源是 Facebook、Instagram、Threads，以及经由 Grok 取得的 X 内容 —— 系统从不直接访问 x.com。只有报告标注 <b>cited</b> 的链接，才代表来源被真正打开过。',
    },
    {
      no: '04',
      name: '广告研究',
      lede: '这家公司眼下实际在投什么广告 —— 覆盖 Facebook 与 Google 两个广告库。',
      need: '一份状态为 <b>completed</b> 或 <b>partial</b> 的 02 公司档案。',
      path: [
        '进入 <b>Reports</b>',
        '找到那份公司档案所在的一行',
        '按 <b>Ads research →</b>',
      ],
      back: '抓取到的广告，按平台分列，并附上广告素材图。',
      next: '结果会出现在 Reports 的 <b>Ads</b> 筛选里，同样是一条永久链接。',
      watch: '如果家里那台采集机器离线，报告会返回 <b>failed</b>。failed 的意思是「什么都没抓到」，<b>不是</b>「这家公司没投广告」。这两件事绝不能混为一谈。',
    },
  ],
  knowHead: '五件该知道的事',
  know: [
    '<b>访问密钥只输入一次。</b>它保存在这台浏览器里，开新标签页也还在，并且永远不会出现在报告链接中。按 <b>Sign out</b> 即清除。',
    '<b>不需要等。</b>所有研究都在后台跑，链接在你按下按钮的那一刻就已经存在。关掉页面也没关系 —— 回来在 <b>Active work</b> 里继续看。',
    '<b>四种状态：</b><span class="pulse"></span><b>running</b>、<b>completed</b>、<b>partial</b>（可用）、<b>failed</b>。',
    '<b>报告链接是永久的。</b>可以收藏，也可以发给没有访问密钥的人。',
    '<b>删除无法撤销。</b>链接立即失效，研究数据一并清除，正在跑的任务也会被一起终止。',
  ],
  openPortal: '进入工作台 →',
};

const chain = (c: Copy): string => `
<section class="chain-wrap" aria-label="${c.chainHead}">
  <h2 class="rule-head">${c.chainHead}</h2>
  <ol class="chain">
    ${c.steps.map((step, i) => `<li class="link${i >= 2 ? ' link-locked' : ''}">
      <span class="link-no">${step.no}</span>
      <span class="link-name">${step.name}</span>
      <span class="link-need">${c.chainNeed[i]}</span>
    </li>`).join('')}
  </ol>
</section>`;

const stepBlock = (c: Copy, step: Step): string => `
<section class="step" id="${c.lang}-step-${step.no}">
  <div class="step-head"><span class="step-no">${step.no}</span><h2>${step.name}</h2></div>
  <p class="lede">${step.lede}</p>
  <dl class="facts">
    <div class="fact"><dt>${c.needLabel}</dt><dd>${step.need}</dd></div>
    <div class="fact"><dt>${c.pathLabel}</dt><dd><ol class="path">${step.path.map((s) => `<li>${s}</li>`).join('')}</ol></dd></div>
    <div class="fact"><dt>${c.backLabel}</dt><dd>${step.back}</dd></div>
    <div class="fact"><dt>${c.nextLabel}</dt><dd>${step.next}</dd></div>
  </dl>
  <p class="watch"><b>${c.watchLabel}</b> ${step.watch}</p>
</section>`;

const article = (c: Copy): string => `
<div class="lang lang-${c.lang}" lang="${c.lang === 'zh' ? 'zh-Hans' : 'en'}">
  <div class="hero">
    <div class="eyebrow">${c.eyebrow}</div>
    <h1>${c.title}</h1>
    <p>${c.intro}</p>
  </div>
  ${chain(c)}
  ${c.steps.map((step) => stepBlock(c, step)).join('')}
  <section class="know">
    <h2 class="rule-head">${c.knowHead}</h2>
    <ul>${c.know.map((item) => `<li>${item}</li>`).join('')}</ul>
  </section>
  <p class="cta"><a href="/portal">${c.openPortal}</a></p>
</div>`;

export function page(): string {
  return `<!doctype html>
<html lang="en" data-lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#151515"><meta name="robots" content="noindex,nofollow">
<title>Guide · EE Business Intelligence</title>
<style>
:root{--paper:#f3f0e8;--sheet:#fbfaf6;--ink:#151515;--muted:#6c6a64;--faint:#9b988f;--line:#cbc6ba;--soft:#e6e1d6;--accent:#2759ff;--ok:#15785a;--bad:#9e382f;--display:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;--sans:Inter,"Helvetica Neue",Arial,sans-serif;--mono:"SFMono-Regular",Consolas,"Liberation Mono",monospace}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.62 var(--sans);-webkit-font-smoothing:antialiased}
b{font-weight:650}
html[data-lang="en"] .lang-zh,html[data-lang="zh"] .lang-en{display:none}
[lang^="zh"]{font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",var(--sans);line-height:1.78}
[lang^="zh"] h1,[lang^="zh"] h2{font-family:"Songti SC","Noto Serif CJK SC","SimSun",var(--display)}

.mast{height:64px;background:var(--ink);color:var(--sheet)}
.mast-inner{height:100%;max-width:880px;margin:auto;padding:0 26px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.brand{display:flex;align-items:center;gap:11px;font:750 11px/1 var(--sans);letter-spacing:.13em;text-transform:uppercase}
.mark{display:grid;place-items:center;width:29px;height:29px;background:var(--sheet);color:var(--ink);font:850 10px/1 var(--sans)}
/* The guide is the page someone is sent before they have a key, so it has to
   say where the workspace is rather than only describing it. */
.mast-nav{display:flex;align-items:center;gap:14px;margin-right:auto;font:700 10px/1 var(--sans);letter-spacing:.1em;text-transform:uppercase}
.mast-nav a{padding:3px 0;border-bottom:1px solid transparent;color:#a5a29a;text-decoration:none;white-space:nowrap}
.mast-nav a:hover{color:var(--sheet)}
.mast-nav a[aria-current="page"]{color:var(--sheet);border-bottom-color:var(--sheet)}
.switch{display:flex;border:1px solid #3b3b38}
.switch button{border:0;background:transparent;color:#a5a29a;min-height:34px;padding:0 13px;font:700 10px/1 var(--sans);letter-spacing:.1em;cursor:pointer}
.switch button[aria-pressed="true"]{background:var(--sheet);color:var(--ink)}

main{max-width:880px;margin:auto;padding:0 26px 90px}
.hero{padding:56px 0 10px}
.eyebrow{display:flex;align-items:center;gap:10px;color:var(--accent);font:700 10px/1 var(--sans);letter-spacing:.17em;text-transform:uppercase}
.eyebrow:before{content:"";width:28px;height:2px;background:var(--accent)}
.hero h1{margin:16px 0 14px;font:400 clamp(38px,6.4vw,62px)/.98 var(--display);letter-spacing:-.05em;text-wrap:balance}
.hero p{max-width:600px;margin:0;color:var(--muted)}
.rule-head{margin:0 0 16px;padding-bottom:11px;border-bottom:1px solid var(--ink);font:750 9px/1 var(--sans);letter-spacing:.14em;text-transform:uppercase}

.chain-wrap{margin:44px 0 8px}
.chain{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;margin:0;padding:0;list-style:none;background:var(--line);border:1px solid var(--line)}
.link{display:flex;flex-direction:column;gap:7px;background:var(--sheet);padding:18px 16px 16px}
.link-no{font:550 10px/1 var(--mono);color:var(--accent);letter-spacing:.1em}
.link-name{font-weight:650;letter-spacing:-.015em}
.link-need{margin-top:auto;color:var(--muted);font:500 10px/1.45 var(--mono);text-transform:uppercase}
.link-locked{background:#efece3}
.link-locked .link-need{color:var(--bad)}

.step{padding:42px 0 6px;border-top:1px solid var(--soft)}
.step:first-of-type{border-top:0}
.step-head{display:flex;align-items:baseline;gap:14px}
.step-no{font:550 11px/1 var(--mono);color:var(--accent)}
.step-head h2{margin:0;font:400 clamp(27px,4.2vw,38px)/1.05 var(--display);letter-spacing:-.035em}
.lede{max-width:620px;margin:12px 0 24px;color:var(--muted)}
.facts{margin:0;border-top:1px solid var(--ink)}
.fact{display:grid;grid-template-columns:150px minmax(0,1fr);gap:22px;padding:16px 0;border-bottom:1px solid var(--line)}
.fact dt{color:var(--muted);font:750 9px/1.5 var(--sans);letter-spacing:.13em;text-transform:uppercase}
.fact dd{margin:0}
.path{margin:0;padding-left:19px}
.path li{margin-bottom:6px}
.path li:last-child{margin-bottom:0}
.watch{margin:20px 0 0;border-left:2px solid var(--accent);padding:2px 0 2px 15px;color:var(--muted);font-size:14px}
.watch b{color:var(--ink);text-transform:uppercase;font:750 9px/1 var(--sans);letter-spacing:.13em;margin-right:8px}
[lang^="zh"] .watch b{margin-right:9px}

.know{margin-top:46px;padding-top:38px;border-top:1px solid var(--soft)}
.know ul{margin:0;padding:0;list-style:none;border-top:1px solid var(--ink)}
.know li{padding:15px 0;border-bottom:1px solid var(--line);color:var(--muted)}
.know b{color:var(--ink)}
.pulse{display:inline-block;width:7px;height:7px;margin-right:9px;border-radius:50%;background:#d29a27;box-shadow:0 0 0 4px rgba(210,154,39,.14);animation:pulse 1.8s infinite}
@keyframes pulse{50%{opacity:.35}}
.cta{margin:38px 0 0}
.cta a{display:inline-block;border:1px solid var(--accent);background:var(--accent);color:#fff;padding:15px 24px;text-decoration:none;font:800 10px/1 var(--sans);letter-spacing:.11em;text-transform:uppercase}
.cta a:hover{background:#1741d0;border-color:#1741d0}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
@media(max-width:760px){
  .mast-inner,main{padding-left:18px;padding-right:18px}
  .mast-inner{gap:12px}
  .brand-word{display:none}
  .hero{padding-top:36px}
  .chain{grid-template-columns:1fr}
  .link{flex-direction:row;align-items:baseline;flex-wrap:wrap;gap:10px;padding:14px 16px}
  .link-need{margin:0;flex-basis:100%}
  .fact{grid-template-columns:1fr;gap:7px;padding:14px 0}
}
</style></head><body>
<header class="mast"><div class="mast-inner">
  <div class="brand"><span class="mark">EE</span><span class="brand-word">Guide</span></div>
  <nav class="mast-nav" aria-label="Site">${navHtml(CLIENT_NAV, '/guide', { bilingual: true })}</nav>
  <div class="switch" role="group" aria-label="Language / 语言">
    <button type="button" data-set-lang="en" aria-pressed="true">EN</button>
    <button type="button" data-set-lang="zh" aria-pressed="false">中文</button>
  </div>
</div></header>
<main>
${article(EN)}
${article(ZH)}
</main>
<script>
(function(){
  var KEY='ee_guide_lang';
  var buttons=document.querySelectorAll('[data-set-lang]');
  function set(lang){
    document.documentElement.setAttribute('data-lang',lang);
    document.documentElement.setAttribute('lang',lang==='zh'?'zh-Hans':'en');
    for(var i=0;i<buttons.length;i++){
      buttons[i].setAttribute('aria-pressed',String(buttons[i].getAttribute('data-set-lang')===lang));
    }
    try{localStorage.setItem(KEY,lang)}catch(e){}
  }
  var saved=null;
  try{saved=localStorage.getItem(KEY)}catch(e){}
  var initial=(saved==='zh'||saved==='en')?saved
    :(String(navigator.language||'').toLowerCase().indexOf('zh')===0?'zh':'en');
  for(var i=0;i<buttons.length;i++){
    buttons[i].addEventListener('click',function(){set(this.getAttribute('data-set-lang'))});
  }
  set(initial);
})();
</script>
</body></html>`;
}
