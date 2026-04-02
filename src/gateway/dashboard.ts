// Cash-Claw Dashboard – Full production-ready monitoring & control UI
// Dark mode, 5 tabs, live WebSocket updates, Chart.js, Alpine.js, Tailwind CSS

export function getDashboardHtml(port: number, authToken: string | null): string {
  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CashClaw Dashboard</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🦞</text></svg>">
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js" defer></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<script>
tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        claw: { 50:'#fef2f2', 500:'#ef4444', 600:'#dc2626', 700:'#b91c1c', 900:'#7f1d1d' }
      }
    }
  }
}
</script>
<style>
[x-cloak] { display: none !important; }
.scrollbar-thin::-webkit-scrollbar { width: 6px; }
.scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
.scrollbar-thin::-webkit-scrollbar-thumb { background: #374151; border-radius: 3px; }
@keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
.animate-pulse-dot { animation: pulse-dot 2s ease-in-out infinite; }
</style>
</head>
<body class="bg-gray-950 text-gray-100 min-h-screen" x-data="dashboard()" x-init="init()">

<!-- Toast Notifications -->
<div class="fixed top-4 right-4 z-50 space-y-2" x-cloak>
  <template x-for="toast in toasts" :key="toast.id">
    <div class="bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 shadow-lg flex items-center gap-3 text-sm"
         x-show="toast.visible"
         x-transition:enter="transition ease-out duration-300"
         x-transition:enter-start="opacity-0 translate-x-4"
         x-transition:enter-end="opacity-100 translate-x-0"
         x-transition:leave="transition ease-in duration-200"
         x-transition:leave-start="opacity-100"
         x-transition:leave-end="opacity-0">
      <span x-text="toast.message"></span>
    </div>
  </template>
</div>

<!-- Header -->
<header class="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between sticky top-0 z-40">
  <div class="flex items-center gap-3">
    <span class="text-2xl">🦞</span>
    <h1 class="text-xl font-bold">CashClaw</h1>
    <span class="text-xs px-2 py-0.5 rounded-full font-semibold"
          :class="agentState==='running'?'bg-emerald-500/20 text-emerald-400':agentState==='paused'?'bg-amber-500/20 text-amber-400':'bg-red-500/20 text-red-400'"
          x-text="agentState==='running'?'● Running':agentState==='paused'?'● Paused':'● Stopped'">
    </span>
  </div>
  <div class="flex items-center gap-4 text-sm text-gray-400">
    <span x-text="'Uptime: '+formatUptime(uptime)"></span>
    <span class="text-xs px-2 py-1 rounded-full font-semibold"
          :class="wsConnected?'bg-emerald-500/20 text-emerald-400':'bg-red-500/20 text-red-400'"
          x-text="wsConnected?'● Live':'● Offline'">
    </span>
  </div>
</header>

<!-- Tab Navigation -->
<nav class="bg-gray-900 border-b border-gray-800 px-6">
  <div class="flex gap-1 max-w-7xl mx-auto">
    <template x-for="tab in tabs" :key="tab.id">
      <button @click="activeTab=tab.id"
              class="px-4 py-3 text-sm font-medium rounded-t-lg transition-colors"
              :class="activeTab===tab.id?'bg-gray-950 text-white border-t-2 border-emerald-500':'text-gray-400 hover:text-gray-200 hover:bg-gray-800'">
        <span x-text="tab.icon+' '+tab.label"></span>
      </button>
    </template>
  </div>
</nav>

<!-- Main Content -->
<main class="max-w-7xl mx-auto p-6">

<!-- Tab 1: Overview -->
<div x-show="activeTab==='overview'" x-cloak>
  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
    <div class="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div class="text-xs text-gray-500 uppercase tracking-wide mb-2">Revenue Today</div>
      <div class="text-2xl font-bold text-emerald-400" x-text="'$'+revenue.today.toFixed(2)"></div>
      <div class="text-xs text-gray-500 mt-1">Week: <span x-text="'$'+revenue.thisWeek.toFixed(2)" class="text-gray-300"></span> | Month: <span x-text="'$'+revenue.thisMonth.toFixed(2)" class="text-gray-300"></span></div>
    </div>
    <div class="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div class="text-xs text-gray-500 uppercase tracking-wide mb-2">Agent Status</div>
      <div class="text-2xl font-bold" :class="agentState==='running'?'text-emerald-400':agentState==='paused'?'text-amber-400':'text-red-400'" x-text="agentState.toUpperCase()"></div>
      <div class="text-xs text-gray-500 mt-1">Cycles: <span x-text="cycleCount" class="text-gray-300"></span></div>
    </div>
    <div class="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div class="text-xs text-gray-500 uppercase tracking-wide mb-2">Tasks Today</div>
      <div class="text-2xl font-bold text-blue-400" x-text="actionsToday"></div>
    </div>
    <div class="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div class="text-xs text-gray-500 uppercase tracking-wide mb-2">LLM Cost Today</div>
      <div class="text-2xl font-bold text-orange-400" x-text="'$'+costToday.toFixed(4)"></div>
      <div class="text-xs text-gray-500 mt-1">Remaining: <span x-text="'$'+costRemaining.toFixed(2)" class="text-emerald-400"></span></div>
    </div>
  </div>

  <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
    <div class="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">AEL Cycle</h3>
      <div class="flex items-center justify-between mb-4">
        <template x-for="phase in ['Observe','Plan','Execute','Reflect']" :key="phase">
          <div class="flex flex-col items-center gap-1">
            <div class="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold" :class="cyclePhase===phase.toLowerCase()?'bg-emerald-500 text-white animate-pulse-dot':'bg-gray-800 text-gray-500'">
              <span x-text="phase[0]"></span>
            </div>
            <span class="text-xs text-gray-500" x-text="phase"></span>
          </div>
        </template>
      </div>
      <div class="text-sm text-gray-400" x-show="currentTask"><span class="text-gray-500">Current:</span> <span x-text="currentTask" class="text-gray-200"></span></div>
    </div>
    <div class="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">Current Task</h3>
      <div x-show="currentTask" class="text-sm text-gray-200" x-text="currentTask"></div>
      <div x-show="!currentTask" class="text-sm text-gray-500">No active task</div>
    </div>
    <div class="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">Quick Controls</h3>
      <div class="flex flex-wrap gap-2">
        <button @click="doAction('resume')" class="px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 rounded-lg">▶ Resume</button>
        <button @click="doAction('pause')" class="px-3 py-1.5 text-xs font-medium bg-amber-600 hover:bg-amber-700 rounded-lg">⏸ Pause</button>
        <button @click="doAction('cycle')" class="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 rounded-lg">🔄 Cycle</button>
        <button @click="doAction('reflect')" class="px-3 py-1.5 text-xs font-medium bg-purple-600 hover:bg-purple-700 rounded-lg">🔍 Reflect</button>
      </div>
      <div class="mt-3">
        <div class="flex gap-2">
          <input id="chatInput" type="text" x-model="chatMsg" placeholder="Message to agent..." class="flex-1 px-3 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-emerald-500" @keydown.enter="sendChat()">
          <button @click="sendChat()" class="px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 rounded-lg">Send</button>
        </div>
        <div x-show="chatReply" class="mt-2 text-xs text-gray-400 bg-gray-800 rounded-lg p-2" x-text="chatReply"></div>
      </div>
    </div>
  </div>

  <!-- Live Activity Feed -->
  <div class="mt-4 bg-gray-900 border border-gray-800 rounded-xl p-5">
    <div class="flex justify-between items-center mb-4">
      <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wide">Live Activity Feed</h3>
      <button @click="logPaused=!logPaused" class="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700" x-text="logPaused?'▶ Resume':'⏸ Pause'"></button>
    </div>
    <div class="bg-gray-950 rounded-lg p-3 h-48 overflow-y-auto scrollbar-thin font-mono text-xs space-y-0.5" id="logFeed">
      <template x-for="entry in logEntries.slice(-100)" :key="entry.ts">
        <div :class="{'text-blue-400':entry.level==='info','text-amber-400':entry.level==='warn','text-red-400':entry.level==='error','text-emerald-400':entry.level==='tool_call'}">
          <span class="text-gray-600" x-text="entry.time"></span> <span x-text="'['+entry.level.toUpperCase()+']'"></span> <span class="text-gray-300" x-text="entry.message"></span>
        </div>
      </template>
    </div>
  </div>
</div>

<!-- Tab 2: Revenue -->
<div x-show="activeTab==='revenue'" x-cloak>
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
    <div class="bg-gray-900 border border-gray-800 rounded-xl p-5"><div class="text-xs text-gray-500 uppercase">Today</div><div class="text-3xl font-bold text-emerald-400" x-text="'$'+revenue.today.toFixed(2)"></div></div>
    <div class="bg-gray-900 border border-gray-800 rounded-xl p-5"><div class="text-xs text-gray-500 uppercase">This Week</div><div class="text-3xl font-bold text-emerald-400" x-text="'$'+revenue.thisWeek.toFixed(2)"></div></div>
    <div class="bg-gray-900 border border-gray-800 rounded-xl p-5"><div class="text-xs text-gray-500 uppercase">This Month</div><div class="text-3xl font-bold text-emerald-400" x-text="'$'+revenue.thisMonth.toFixed(2)"></div></div>
  </div>
  <div class="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
    <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">Revenue (Last 30 Days)</h3>
    <div style="height:250px"><canvas id="revenueChart"></canvas></div>
  </div>
  <div class="bg-gray-900 border border-gray-800 rounded-xl p-5">
    <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">Recent Payments</h3>
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead><tr class="text-gray-500 text-xs uppercase border-b border-gray-800"><th class="py-2 text-left">Date</th><th class="py-2 text-left">Description</th><th class="py-2 text-right">Amount</th><th class="py-2 text-right">Status</th></tr></thead>
        <tbody>
          <template x-for="p in revenue.recentPayments" :key="p.date">
            <tr class="border-b border-gray-800/50"><td class="py-2 text-gray-400" x-text="new Date(p.date).toLocaleDateString()"></td><td class="py-2" x-text="p.description"></td><td class="py-2 text-right text-emerald-400 font-medium" x-text="'$'+p.amount.toFixed(2)"></td><td class="py-2 text-right"><span class="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400" x-text="p.status"></span></td></tr>
          </template>
          <tr x-show="revenue.recentPayments.length===0"><td colspan="4" class="py-4 text-center text-gray-500">No payments recorded</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</div>

<!-- Tab 3: Tools -->
<div x-show="activeTab==='tools'" x-cloak>
  <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
    <div class="bg-gray-900 border border-gray-800 rounded-xl p-5"><div class="text-xs text-gray-500 uppercase mb-1">Docker</div><div class="flex items-center gap-2"><span class="w-2 h-2 rounded-full" :class="sandboxStatus.available?'bg-emerald-400':'bg-red-400'"></span><span x-text="sandboxStatus.available?'Available (v'+sandboxStatus.version+')':'Not installed'" class="text-sm"></span></div></div>
    <div class="bg-gray-900 border border-gray-800 rounded-xl p-5"><div class="text-xs text-gray-500 uppercase mb-1">Sandbox</div><span x-text="sandboxStatus.enabled?'Enabled':'Disabled'" :class="sandboxStatus.enabled?'text-emerald-400':'text-amber-400'" class="text-sm font-medium"></span></div>
    <div class="bg-gray-900 border border-gray-800 rounded-xl p-5"><div class="text-xs text-gray-500 uppercase mb-1">Total Tools</div><span class="text-2xl font-bold text-blue-400" x-text="toolStats.length"></span></div>
  </div>
  <div class="bg-gray-900 border border-gray-800 rounded-xl p-5">
    <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">Tool Performance</h3>
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead><tr class="text-gray-500 text-xs uppercase border-b border-gray-800"><th class="py-2 text-left">Tool</th><th class="py-2 text-right">Calls</th><th class="py-2 text-right">Avg Duration</th><th class="py-2 text-right">Success</th></tr></thead>
        <tbody>
          <template x-for="t in toolStats" :key="t.name">
            <tr class="border-b border-gray-800/50 hover:bg-gray-800/30"><td class="py-2 font-mono text-xs text-blue-400" x-text="t.name"></td><td class="py-2 text-right text-gray-300" x-text="t.callsToday"></td><td class="py-2 text-right text-gray-400" x-text="t.avgDurationMs+'ms'"></td><td class="py-2 text-right"><span :class="t.successRate>=90?'text-emerald-400':t.successRate>=50?'text-amber-400':'text-red-400'" x-text="t.successRate.toFixed(0)+'%'"></span></td></tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</div>

<!-- Tab 4: Plans & Reflections -->
<div x-show="activeTab==='plans'" x-cloak>
  <div class="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
    <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">Completed Tasks</h3>
    <div class="space-y-2 max-h-64 overflow-y-auto scrollbar-thin">
      <template x-for="task in tasksCompleted.slice().reverse()" :key="task.taskId">
        <div class="flex items-center justify-between bg-gray-800/50 rounded-lg px-3 py-2 text-sm">
          <div class="flex items-center gap-2"><span x-text="task.success?'✅':'❌'"></span><span x-text="task.title" class="text-gray-200"></span></div>
          <div class="text-xs text-gray-500"><span x-text="'$'+task.costUsd.toFixed(4)"></span> | <span x-text="task.durationMs+'ms'"></span></div>
        </div>
      </template>
      <div x-show="tasksCompleted.length===0" class="text-sm text-gray-500">No tasks completed yet</div>
    </div>
  </div>
  <div class="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
    <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">Daily Reflections</h3>
    <div class="space-y-3">
      <template x-for="r in reflections" :key="r.date">
        <details class="bg-gray-800/50 rounded-lg">
          <summary class="px-4 py-3 cursor-pointer text-sm text-gray-200 hover:bg-gray-800 rounded-lg">🌙 <span x-text="r.date"></span> – <span x-text="r.summary" class="text-gray-400"></span></summary>
          <div class="px-4 py-3 text-sm space-y-2 border-t border-gray-700">
            <div x-show="r.achievements&&r.achievements.length>0"><span class="text-emerald-400 text-xs uppercase">Achievements:</span><ul class="list-disc list-inside text-gray-300 mt-1"><template x-for="a in r.achievements"><li x-text="a"></li></template></ul></div>
            <div x-show="r.improvements&&r.improvements.length>0"><span class="text-amber-400 text-xs uppercase">Improvements:</span><ul class="list-disc list-inside text-gray-300 mt-1"><template x-for="i in r.improvements"><li x-text="i"></li></template></ul></div>
          </div>
        </details>
      </template>
      <div x-show="reflections.length===0" class="text-sm text-gray-500">No reflections yet</div>
    </div>
  </div>
  <div class="bg-gray-900 border border-gray-800 rounded-xl p-5">
    <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">Learning Log</h3>
    <div class="space-y-2 max-h-48 overflow-y-auto scrollbar-thin">
      <template x-for="l in learnings" :key="l.id">
        <div class="text-sm bg-gray-800/50 rounded-lg px-3 py-2"><span class="text-blue-400 font-mono text-xs" x-text="l.id"></span> <span class="text-gray-300" x-text="l.content"></span></div>
      </template>
      <div x-show="learnings.length===0" class="text-sm text-gray-500">No learnings recorded yet</div>
    </div>
  </div>
</div>

<!-- Tab 5: Settings -->
<div x-show="activeTab==='settings'" x-cloak>
  <div class="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
    <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">Agent Control</h3>
    <div class="flex flex-wrap gap-3">
      <button @click="doAction('resume')" class="px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-700 rounded-lg">▶ Resume</button>
      <button @click="doAction('pause')" class="px-4 py-2 text-sm font-medium bg-amber-600 hover:bg-amber-700 rounded-lg">⏸ Pause</button>
      <button @click="doAction('stop')" class="px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-700 rounded-lg">⏹ Stop</button>
      <button @click="doAction('cycle')" class="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 rounded-lg">🔄 Restart Cycle</button>
    </div>
  </div>
  <div class="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
    <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">Configuration</h3>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
      <div><span class="text-gray-500">LLM Provider:</span><span class="text-gray-200 ml-2" x-text="maskedConfig?.llm?.provider??'N/A'"></span></div>
      <div><span class="text-gray-500">Model:</span><span class="text-gray-200 ml-2" x-text="maskedConfig?.llm?.model??'N/A'"></span></div>
      <div><span class="text-gray-500">Platform:</span><span class="text-gray-200 ml-2" x-text="maskedConfig?.platform?.type??'N/A'"></span></div>
      <div><span class="text-gray-500">Stripe:</span><span class="text-gray-200 ml-2" x-text="maskedConfig?.stripe?.connected?'Connected':'Not connected'"></span></div>
      <div><span class="text-gray-500">Categories:</span><span class="text-gray-200 ml-2" x-text="maskedConfig?.categories?Object.entries(maskedConfig.categories).filter(([,v])=>v).map(([k])=>k).join(', '):'N/A'"></span></div>
      <div><span class="text-gray-500">Budget:</span><span class="text-gray-200 ml-2" x-text="'$'+(maskedConfig?.financeLimits?.dailyApiBudgetUsd??0)+'/day'"></span></div>
      <div><span class="text-gray-500">Work Hours:</span><span class="text-gray-200 ml-2" x-text="(maskedConfig?.schedule?.activeFrom??'00:00')+' - '+(maskedConfig?.schedule?.activeTo??'24:00')"></span></div>
    </div>
  </div>
  <div class="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
    <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">Channel Status</h3>
    <div class="space-y-3">
      <div class="flex items-center justify-between"><span class="text-sm">Telegram</span><span class="text-xs px-2 py-0.5 rounded-full" :class="channels.telegram==='connected'?'bg-emerald-500/20 text-emerald-400':channels.telegram==='disabled'?'bg-gray-700 text-gray-500':'bg-red-500/20 text-red-400'" x-text="channels.telegram==='connected'?'✓ Connected':channels.telegram==='disabled'?'○ Disabled':'✗ Disconnected'"></span></div>
      <div class="flex items-center justify-between"><span class="text-sm">WhatsApp</span><span class="text-xs px-2 py-0.5 rounded-full" :class="channels.whatsapp==='connected'?'bg-emerald-500/20 text-emerald-400':channels.whatsapp==='disabled'?'bg-gray-700 text-gray-500':'bg-red-500/20 text-red-400'" x-text="channels.whatsapp==='connected'?'✓ Connected':channels.whatsapp==='disabled'?'○ Disabled':'✗ Disconnected'"></span></div>
      <div class="flex items-center justify-between"><span class="text-sm">Docker Sandbox</span><span class="text-xs px-2 py-0.5 rounded-full" :class="channels.docker==='available'?'bg-emerald-500/20 text-emerald-400':'bg-red-500/20 text-red-400'" x-text="channels.docker==='available'?'✓ Available':'✗ Not installed'"></span></div>
    </div>
  </div>
  <div class="bg-gray-900 border border-red-900/50 rounded-xl p-5">
    <h3 class="text-sm font-semibold text-red-400 uppercase tracking-wide mb-4">Danger Zone</h3>
    <button @click="if(confirm('Clear all logs?'))clearLogs()" class="px-4 py-2 text-sm font-medium border border-red-700 text-red-400 hover:bg-red-900/30 rounded-lg">Clear all logs</button>
  </div>
</div>

</main>

<script>
function dashboard(){return{
activeTab:'overview',
tabs:[{id:'overview',icon:'📊',label:'Overview'},{id:'revenue',icon:'💰',label:'Revenue'},{id:'tools',icon:'🔧',label:'Tools & Execution'},{id:'plans',icon:'📝',label:'Plans & Reflections'},{id:'settings',icon:'⚙️',label:'Settings & Control'}],
agentState:'idle',cycleCount:0,actionsToday:0,costToday:0,costRemaining:0,currentTask:null,cyclePhase:'idle',uptime:0,tasksCompleted:[],
revenue:{today:0,thisWeek:0,thisMonth:0,recentPayments:[],dailyRevenue:[],categories:{}},
toolStats:[],sandboxStatus:{available:false,enabled:false,version:'N/A'},
reflections:[],learnings:[],
maskedConfig:{},channels:{telegram:'disabled',whatsapp:'disabled',docker:'disabled'},
logEntries:[],logPaused:false,
wsConnected:false,ws:null,
toasts:[],toastId:0,revenueChart:null,
chatMsg:'',chatReply:'',
PORT:${port},AUTH:${authToken?JSON.stringify(authToken):"null"},
init(){this.loadAll();this.connectWs();setInterval(()=>{this.loadState();this.loadCosts();},30000);setInterval(()=>{this.uptime=performance.now()/1000;},1000);},
get BASE(){return'http://127.0.0.1:'+this.PORT;},
headers(){const h={'Content-Type':'application/json'};if(this.AUTH)h['Authorization']='Bearer '+this.AUTH;return h;},
async fetchJson(p){const r=await fetch(this.BASE+p,{headers:this.headers()});return r.json();},
async loadAll(){await Promise.all([this.loadState(),this.loadCosts(),this.loadTools(),this.loadRevenue(),this.loadReflections(),this.loadConfig()]);},
async loadState(){try{const s=await this.fetchJson('/api/state');this.agentState=s.running?(s.paused?'paused':'running'):'idle';this.cycleCount=s.cycleCount||0;this.actionsToday=s.actionsToday||0;this.costToday=s.costToday||0;this.currentTask=s.currentTask?.title||null;this.tasksCompleted=s.tasksCompleted||[];}catch(e){this.addLog('error','State: '+e.message);}},
async loadCosts(){try{const c=await this.fetchJson('/api/costs');this.costToday=c.todayCost||0;this.costRemaining=c.remaining||0;}catch(e){this.addLog('error','Costs: '+e.message);}},
async loadTools(){try{const t=await this.fetchJson('/api/tools/stats');if(t.tools)this.toolStats=t.tools;if(t.sandbox)this.sandboxStatus=t.sandbox;}catch{try{const t=await this.fetchJson('/api/tools');this.toolStats=(t.tools||[]).map(t=>({name:t.name,callsToday:0,avgDurationMs:0,successRate:100}));}catch(e){this.addLog('error','Tools: '+e.message);}}},
async loadRevenue(){try{const r=await this.fetchJson('/api/revenue');if(r.success!==false){Object.assign(this.revenue,r);this.$nextTick(()=>this.updateRevenueChart());}}catch{}},
async loadReflections(){try{const r=await this.fetchJson('/api/reflections');if(r.reflections)this.reflections=r.reflections;}catch{}},
async loadConfig(){try{const c=await this.fetchJson('/api/config');if(c.success!==false){this.maskedConfig=c.data||c;if(c.data?.channels)this.channels=c.data.channels;}}catch{}},
async doAction(a){try{await fetch(this.BASE+'/api/control',{method:'POST',headers:this.headers(),body:JSON.stringify({action:a})});this.showToast(a+' ✓');setTimeout(()=>this.loadState(),500);}catch(e){this.showToast('Failed: '+e.message);}},
async sendChat(){const m=this.chatMsg.trim();if(!m)return;this.chatMsg='';this.chatReply='Sending...';try{const r=await fetch(this.BASE+'/api/chat',{method:'POST',headers:this.headers(),body:JSON.stringify({message:m})});const d=await r.json();this.chatReply=d.reply||d.error||'No response';}catch(e){this.chatReply='Error: '+e.message;}},
clearLogs(){this.logEntries=[];this.showToast('Logs cleared ✓');},
addLog(level,message){if(this.logPaused)return;this.logEntries.push({ts:Date.now(),time:new Date().toLocaleTimeString(),level,message});if(this.logEntries.length>500)this.logEntries=this.logEntries.slice(-500);this.$nextTick(()=>{const f=document.getElementById('logFeed');if(f)f.scrollTop=f.scrollHeight;});},
showToast(m){const id=++this.toastId;const t={id,message:m,visible:true};this.toasts.push(t);setTimeout(()=>{t.visible=false;},3000);setTimeout(()=>{this.toasts=this.toasts.filter(x=>x.id!==id);},3500);},
formatUptime(s){const h=Math.floor(s/3600);const m=Math.floor((s%3600)/60);return h>0?h+'h '+m+'m':m+'m';},
connectWs(){if(this.ws&&this.ws.readyState<=1)return;this.ws=new WebSocket('ws://127.0.0.1:'+this.PORT+'/ws');this.ws.onopen=()=>{this.wsConnected=true;this.addLog('info','WebSocket connected');this.ws.send(JSON.stringify({type:'connect',version:1,token:this.AUTH||undefined}));};this.ws.onmessage=(e)=>{try{const m=JSON.parse(e.data);if(m.type==='event')this.handleWsEvent(m);}catch{}};this.ws.onclose=()=>{this.wsConnected=false;this.addLog('warn','WebSocket disconnected');setTimeout(()=>this.connectWs(),3000);};this.ws.onerror=()=>{};},
handleWsEvent(msg){const evt=msg.event;const p=msg.payload||{};switch(evt){case'cycle_start':this.addLog('info','Cycle #'+(p.cycle||'?'));break;case'plan_complete':this.addLog('info','Plan: '+(p.taskCount||0)+' tasks');break;case'task_start':this.addLog('tool_call','Task: '+(p.title||'?'));this.currentTask=p.title||null;break;case'task_complete':this.addLog(p.success?'info':'error','Done: '+(p.title||'?')+' '+(p.success?'✓':'✗'));break;case'review_complete':this.addLog('info','Review done');break;case'cost_update':this.costToday=p.todayCost||0;break;case'log':this.addLog(p.level||'info',p.message||'');break;case'ael_cycle':this.cyclePhase=p.phase||'idle';break;case'tool_call':this.addLog('tool_call',p.tool+' ('+(p.duration||0)+'ms) '+(p.success?'✓':'✗'));break;case'status':this.agentState=p.state||'idle';break;case'revenue':this.addLog('info','Revenue: $'+(p.amount||0));break;default:this.addLog('info',evt+': '+JSON.stringify(p));}if(['cycle_start','task_complete','review_complete','plan_complete'].includes(evt)){this.loadState();this.loadCosts();}},
updateRevenueChart(){const c=document.getElementById('revenueChart');if(!c)return;const d=this.revenue.dailyRevenue||[];const labels=d.map(x=>x.date.substring(5));const values=d.map(x=>x.amount);if(this.revenueChart){this.revenueChart.data.labels=labels;this.revenueChart.data.datasets[0].data=values;this.revenueChart.update();return;}this.revenueChart=new Chart(c,{type:'bar',data:{labels,datasets:[{label:'Revenue ($)',data:values,backgroundColor:'rgba(16,185,129,0.5)',borderColor:'rgba(16,185,129,1)',borderWidth:1,borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{color:'rgba(75,85,99,0.3)'},ticks:{color:'#9ca3af'}},y:{grid:{color:'rgba(75,85,99,0.3)'},ticks:{color:'#9ca3af',callback:v=>'$'+v}}}}});}
};}
</script>
</body>
</html>`;
}
