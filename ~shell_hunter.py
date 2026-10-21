import akshare as ak
import requests
import time
from datetime import datetime

WEBHOOK = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=3a20cfaf-9607-4289-a7ee-a6b073e4726b"
CAP_LIMIT = 8000000000
API_KEY = "sk-dc6e773d0d9c4a46994214126391f115"

KEYWORDS = [
    "重大资产重组", "发行股份购买资产",
    "控制权变更", "实际控制人变更", "实控人变更",
    "协议转让", "吸收合并", "要约收购"
]

def push_wechat(msg):
    try:
        requests.post(WEBHOOK, json={"msgtype": "text", "text": {"content": "重组雷达:\n" + msg}}, timeout=10)
        print(">>> Push to Wechat success!")
    except Exception as e:
        print(">>> Push failed: " + str(e))

def analyze_title(title):
    prompt = ("You are an A-share assistant. Rate with [G/Y/R]. G good asset, Y normal, R bad asset or ST shell. "
              "Output [G/Y/R] and reason within 20 words. Title: " + title)
    try:
        resp = requests.post(
            "https://open.bigmodel.cn/api/paas/v4/chat/completions",
            headers={"Authorization": "Bearer " + API_KEY, "Content-Type": "application/json"},
            json={"model": "glm-4-flash", "messages": [{"role": "user", "content": prompt}]},
            timeout=15
        )
        if resp.status_code == 200:
            return resp.json()['choices'][0]['message']['content']
    except Exception as e:
        return "[Y] AI Error: " + str(e)
    return "[Y] AI Error"

def get_cap(code):
    # 腾讯行情接口拿市值(单位:元), 不依赖东财
    if code.startswith("6"):
        q = "sh" + code
    elif code.startswith(("0", "3")):
        q = "sz" + code
    else:
        q = "bj" + code
    for i in range(3):
        try:
            r = requests.get("http://qt.gtimg.cn/q=" + q, timeout=10)
            r.encoding = "gbk"
            parts = r.text.split("~")
            nm = parts[1]
            mcap = float(parts[45]) * 1e8  # 总市值(亿)->元
            return nm, mcap
        except Exception as e:
            time.sleep(2)
    return None, 0

print(">>> [" + datetime.now().strftime('%H:%M:%S') + "] Start scanning...")

try:
    date = datetime.now().strftime("%Y%m%d")
    notices = ak.stock_notice_report(date=date)
except Exception as e:
    print("!!! FATAL: notices network error! " + str(e))
    exit()

if notices is None or notices.empty:
    print("No notices today")
    exit()

hit = notices[notices["公告标题"].apply(lambda t: isinstance(t, str) and any(k in t for k in KEYWORDS))]
if hit.empty:
    print("No hard signals today")
    exit()

print("--- Found " + str(len(hit)) + " hard signals, checking cap via Tencent ---")

out = []
seen = set()
for _, row in hit.iterrows():
    c = str(row["代码"]).strip()
    if c in seen:
        continue
    seen.add(c)
    title = row["公告标题"]
    print("  >> Querying cap for " + c)
    nm, cap = get_cap(c)
    if nm is None:
        # 市值拿不到: 降级直接推送, 标注 NA, 人工判断
        print("     ! cap NA, push anyway")
        analysis = analyze_title(title)
        out.append(analysis + "\n[" + c + " cap:NA] " + title)
        time.sleep(1)
        continue
    if "ST" in nm.upper():
        print("     ! skip ST: " + nm)
        continue
    if cap > 0 and cap < CAP_LIMIT:
        print("  >> AI Analyzing: " + nm + " cap:" + str(round(cap/1e8,1)) + "Y")
        analysis = analyze_title(title)
        out.append(analysis + "\n[" + c + " " + nm + " cap:" + str(round(cap/1e8, 1)) + "Y] " + title)
    else:
        print("     ! skip large cap: " + nm)
    time.sleep(1)

if out:
    final_msg = "\n\n".join(out)
    print("\n" + "=" * 30)
    print(final_msg)
    print("=" * 30)
    push_wechat(final_msg)
else:
    print("No small-cap targets matched.")
