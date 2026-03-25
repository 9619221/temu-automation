#!/bin/bash
# Temu 一键数据采集脚本
# 用法: bash collect.sh [全量|单个key]

WORKER_PORT=${WORKER_PORT:-19280}
WORKER_URL="http://localhost:${WORKER_PORT}"
PROJECT_DIR="C:/Users/Administrator/temu-automation"

# 颜色
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}=== Temu 数据采集 ===${NC}"

# 1. 检查 Worker 是否运行
echo -n "检查 Worker 状态... "
PING=$(curl -s -X POST "$WORKER_URL" -d '{"type":"ping"}' --connect-timeout 3 2>/dev/null)
if [ $? -ne 0 ] || [ -z "$PING" ]; then
    echo -e "${RED}未运行${NC}"
    echo "启动 Worker..."
    cd "$PROJECT_DIR"
    node automation/worker.mjs &
    WORKER_PID=$!

    # 等待 Worker 就绪
    for i in $(seq 1 30); do
        sleep 1
        PING=$(curl -s -X POST "$WORKER_URL" -d '{"type":"ping"}' --connect-timeout 2 2>/dev/null)
        if [ $? -eq 0 ] && [ -n "$PING" ]; then
            echo -e "${GREEN}Worker 已就绪${NC}"
            break
        fi
        echo -n "."
    done
else
    echo -e "${GREEN}运行中${NC}"
fi

# 2. 执行采集
KEY="${1:-all}"

if [ "$KEY" = "all" ] || [ "$KEY" = "全量" ]; then
    echo -e "\n${YELLOW}开始全量采集 (62个数据源)...${NC}"
    echo "预计耗时 10-15 分钟，请耐心等待..."

    RESULT=$(curl -s -X POST "$WORKER_URL" \
        -H "Content-Type: application/json" \
        -d '{"type":"scrape_all"}' \
        --max-time 1800 2>/dev/null)

    if [ $? -eq 0 ] && [ -n "$RESULT" ]; then
        SUCCESS=$(echo "$RESULT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d.data?.successCount||0)" 2>/dev/null)
        FAIL=$(echo "$RESULT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d.data?.failCount||0)" 2>/dev/null)
        DURATION=$(echo "$RESULT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(Math.round((d.data?.totalDuration||0)/1000))" 2>/dev/null)

        echo -e "\n${GREEN}=== 采集完成 ===${NC}"
        echo -e "成功: ${GREEN}${SUCCESS}${NC} | 失败: ${RED}${FAIL}${NC} | 耗时: ${DURATION}秒"
    else
        echo -e "\n${RED}采集失败或超时${NC}"
        exit 1
    fi
else
    echo -e "\n${YELLOW}采集单个数据源: ${KEY}${NC}"

    RESULT=$(curl -s -X POST "$WORKER_URL" \
        -H "Content-Type: application/json" \
        -d "{\"type\":\"scrape_${KEY}\"}" \
        --max-time 300 2>/dev/null)

    if [ $? -eq 0 ] && [ -n "$RESULT" ]; then
        echo -e "${GREEN}采集完成${NC}"
        echo "$RESULT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(JSON.stringify(d,null,2).slice(0,500))" 2>/dev/null
    else
        echo -e "${RED}采集失败${NC}"
        exit 1
    fi
fi

echo -e "\n${GREEN}数据已保存到: %APPDATA%/temu-automation/${NC}"
