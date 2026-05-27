# Demo Script

## Launch

Start the backend:

```powershell
cd D:\CHI\backend
D:\CHI\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8011
```

Start the frontend:

```powershell
cd D:\CHI\frontend
npm run dev -- --port 5174
```

Open:

```text
http://127.0.0.1:5174
```

## Method Note

The planning feature is a deterministic candidate-based response generator. It
does not claim to find a globally optimal path. It generates route, altitude,
and camera alternatives, evaluates them with the backend exposure engine, and
presents suggested alternatives for the participant or facilitator to inspect.

规划功能是确定性的候选方案生成器，并不声称找到全局最优路径。系统生成航线、高度和相机替代方案，用后端暴露估计引擎评估，再把建议方案呈现给参与者或研究人员选择。

## Walkthrough

The app shows the same lightweight guidance in English and Chinese.

界面会同时显示简洁的英文和中文使用指南。

1. Confirm the `Hong Kong Mong Kok Visual Exposure Study` scenario loads.
   确认 `Hong Kong Mong Kok Visual Exposure Study` 场景已经加载。

2. Inspect the route, buildings, UAV glyphs, and camera frustums.
   查看航线、建筑、无人机标记和相机视锥。

3. Use the condition switch:
   使用条件切换按钮：
   - `C1 Basic Notice`: notice only, no exposure or planning tools.
   - `C2 Route + Footprint`: route and camera footprint/frustum only.
   - `C3 Visual Exposure`: full exposure, preference, and planning workflow.

4. Return to `C3 Visual Exposure`.
   回到 `C3 Visual Exposure`。

5. Select a camera mode: `Wide Survey`, `Balanced Inspection`, or `Focused Detail`.
   选择相机模式：`Wide Survey`、`Balanced Inspection` 或 `Focused Detail`。

6. Optionally expand `Advanced Camera` to inspect reproducible raycasting parameters.
   如需查看可复现实验参数，可展开 `Advanced Camera`。

7. Click `New Manual Route`, select three or more waypoints on the map, then click `Finish Route`.
   点击 `New Manual Route`，在地图上选择至少三个航点，然后点击 `Finish Route`。

8. Click `Compute Exposure`.
   点击 `Compute Exposure` 计算估计视觉暴露。

9. Inspect total exposure, sensitive exposure, route length, task coverage, ray count, and affected building/area highlights.
   查看总暴露、敏感暴露、航线长度、任务覆盖率、射线数量，以及受影响建筑和区域高亮。

10. Turn layers on/off with the layer toggles.
    使用图层开关显示或隐藏不同图层。

11. Click an exposure surface to inspect surface id, semantic type, sensitivity, visible count, and exposure.
    点击暴露面片，查看面片编号、语义类型、敏感度、可见次数和暴露值。

12. Select `Sensitive` or `Do Not Capture`, then click three or more points on the map.
    选择 `Sensitive` 或 `Do Not Capture`，然后在地图上点击三个或更多点。

13. Click `Close Polygon`.
    点击 `Close Polygon` 闭合多边形。

14. Click `Show Preference-Weighted Exposure`.
    点击 `Show Preference-Weighted Exposure`，查看当前航线在用户偏好加权后的暴露变化。这个步骤只改变关注权重，不会生成新航线。

15. Click `Generate Privacy Options`.
    点击 `Generate Privacy Options`，生成隐私感知的建议替代方案。

16. Preview the suggested alternatives and compare exposure reduction, route length change, coverage change, and explanation text.
    预览建议方案，并比较暴露降低、航线长度变化、覆盖率变化和解释文本。

17. Click `Apply` on one suggested alternative.
    对一个建议方案点击 `Apply`。

18. Click `Compute Exposure` again so the final displayed exposure uses the full camera fidelity.
    再次点击 `Compute Exposure`，让最终显示的暴露结果使用完整相机精度重新计算。

19. Click `Download Study Log` to export JSONL-style interaction logs for analysis.
    点击 `Download Study Log` 导出 JSONL 风格的交互日志用于分析。

20. Upload a route with GeoJSON or WKT and repeat the workflow if needed.
    如有需要，可上传 GeoJSON 或 WKT 航线并重复流程。
