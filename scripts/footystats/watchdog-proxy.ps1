# watchdog-proxy.ps1
# ─────────────────────────────────────────────
# 목적: home-proxy-server.js(8787 포트)가 죽어있으면 자동으로 재시작.
# 작업 스케줄러에 "몇 분마다 반복" 트리거로 등록해서 사용하세요(아래 설치 안내 참고).
#
# 가벼운 포트 확인(Test-NetConnection)만 쓰고, 매번 footystats.org까지 실제로
# 요청을 보내진 않습니다 — 그래야 자주(5분마다 등) 돌려도 부담이 없어요.
# ─────────────────────────────────────────────

$ErrorActionPreference = 'SilentlyContinue'

$proxyDir     = "C:\Users\tcp80\sports-site\scripts\footystats"
$proxySecret  = "akdcl-235800-qudtls"
$logPath      = Join-Path $proxyDir "watchdog.log"

function Write-Log($msg) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$timestamp - $msg" | Out-File -FilePath $logPath -Append -Encoding utf8
}

# ── 홈 프록시 서버(8787) 상태 확인 ──
$portTest = Test-NetConnection -ComputerName "localhost" -Port 8787 -WarningAction SilentlyContinue

if (-not $portTest.TcpTestSucceeded) {
    Write-Log "⚠️ 8787 포트 응답 없음 — home-proxy-server.js 재시작 시도"

    # 혹시 포트는 안 죽었는데 프로세스만 좀비 상태로 남아있을 수 있으니,
    # 8787을 물고 있던 흔적이 있는 node 프로세스가 있으면 먼저 정리
    Get-Process -Name node -ErrorAction SilentlyContinue | ForEach-Object {
        $conn = Get-NetTCPConnection -OwningProcess $_.Id -LocalPort 8787 -ErrorAction SilentlyContinue
        if ($conn) {
            Write-Log "   기존 프로세스(PID $($_.Id)) 정리 중"
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        }
    }

    Start-Sleep -Seconds 2

    $env:PROXY_SECRET = $proxySecret
    Start-Process -FilePath "node" -ArgumentList "home-proxy-server.js" `
        -WorkingDirectory $proxyDir -WindowStyle Hidden

    Start-Sleep -Seconds 3

    # 재시작이 실제로 성공했는지 한 번 더 확인
    $recheck = Test-NetConnection -ComputerName "localhost" -Port 8787 -WarningAction SilentlyContinue
    if ($recheck.TcpTestSucceeded) {
        Write-Log "✅ home-proxy-server.js 재시작 성공"
    } else {
        Write-Log "❌ home-proxy-server.js 재시작 실패 — 수동 확인 필요"
    }
} else {
    # 정상일 때는 로그가 너무 쌓이지 않도록 별도 표시 없이 넘어감
    # (문제 생겼을 때 기록만 남기는 방식 — 필요하면 아래 줄 주석 해제해서 항상 기록 가능)
    # Write-Log "✅ 정상"
}

# ── cloudflared 터널 상태 확인 ──
# 실제 시작 스크립트(start-cloudflared.ps1)와 동일한 위치·명령어를 그대로 재현한다.
$cloudflaredDir = "C:\Users\tcp80"
$tunnelProcess  = Get-Process -Name cloudflared -ErrorAction SilentlyContinue

if (-not $tunnelProcess) {
    Write-Log "⚠️ cloudflared 프로세스 없음 — 터널 재시작 시도"

    Start-Process -FilePath (Join-Path $cloudflaredDir "cloudflared.exe") -ArgumentList "tunnel run home-proxy" `
        -WorkingDirectory $cloudflaredDir -WindowStyle Hidden

    Start-Sleep -Seconds 3

    $recheck = Get-Process -Name cloudflared -ErrorAction SilentlyContinue
    if ($recheck) {
        Write-Log "✅ cloudflared 터널 재시작 성공"
    } else {
        Write-Log "❌ cloudflared 터널 재시작 실패 — 수동 확인 필요"
    }
}