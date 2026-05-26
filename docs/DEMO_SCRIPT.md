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

## Walkthrough

The app now shows the same guidance in English and Chinese.

应用界面会同时显示英文和中文使用指南。

1. Confirm the `Hong Kong Mong Kok Visual Exposure Study` scenario loads.
   确认 `Hong Kong Mong Kok Visual Exposure Study` 场景已加载。
2. Inspect the route, buildings, UAV glyphs, and camera frustums.
   查看航线、建筑、无人机标记和相机视锥。
3. Use the condition switch:
   - `C1 Basic Notice`
   - `C2 Route + Footprint`
   - `C3 Visual Exposure`
   使用条件切换按钮选择实验界面。
4. Return to `C3 Visual Exposure`.
   回到 `C3 Visual Exposure`。
5. Select a camera mode: `Wide Survey`, `Balanced Inspection`, or `Focused Detail`.
   选择相机模式：`Wide Survey`、`Balanced Inspection` 或 `Focused Detail`。
6. Optionally expand `Advanced Camera` to show the reproducible raycasting parameters.
   如需查看可复现的射线计算参数，可展开 `Advanced Camera`。
7. Click `New Manual Route`, select three or more waypoints on the map, then click `Finish Route`.
   点击 `New Manual Route`，在地图上选择至少三个航点，然后点击 `Finish Route`。
8. Click `Compute Exposure`.
   点击 `Compute Exposure` 计算视觉暴露。
9. Inspect total exposure, sensitive exposure, route length, task coverage, and ray count.
   查看总暴露、敏感暴露、航线长度、任务覆盖率和射线数量。
10. Turn layers on/off with the layer toggles.
   使用图层开关显示或隐藏不同图层。
11. Click an exposure surface to inspect surface id, semantic type, sensitivity, visible count, and exposure.
   点击暴露面片，查看面片编号、语义类型、敏感度、可见次数和暴露值。
12. Select `Sensitive` or `Do Not Capture`, then click three or more points on the map.
   选择 `Sensitive` 或 `Do Not Capture`，然后在地图上点击三个或更多点。
13. Click `Close Polygon`.
   点击 `Close Polygon` 闭合多边形。
14. Click `Compare With Preferences` to show before/after trade-off feedback.
   点击 `Compare With Preferences` 查看应用偏好前后的取舍反馈。
15. Upload a route with GeoJSON or WKT and repeat the computation.
   上传 GeoJSON 或 WKT 航线，并重复计算流程。
