# София в 3D

Самостоятелна статична карта с CesiumJS 1.133. Цялата папка може да се премести в друга директория или репозитори.

## Стартиране

Отвори терминал в тази папка и стартирай локален сървър за статичните файлове. Например с Node.js:

```sh
node server.mjs 8080
```

Отвори [http://localhost:8080](http://localhost:8080). Нужна е интернет връзка за CesiumJS, базовата карта, терена и 3D сградите.

## Данни

- Терен на София от Cesium ion с asset ID `2564867`.
- Оригиналният набор [3D Tiles на сградите на София](https://raw.githubusercontent.com/eshirinyan/three_sample/refs/heads/main/sofia_building_tiles_20261027/tileset.json). Моделите и идентификаторите им идват директно от набора.

Картата използва същите клиентски Cesium ion токени като основния проект. При промяна на достъпа до ресурсите ги обнови в `main.js`.

## Слоеве и слайдове

- `layers.js` съдържа слоевете по ID. `building-class` оцветява сградите по `citygml_class_description` със същите категории и цветове като в основния проект.
- `presentationSteps` в `slides.js` съдържа осемте стъпки на презентацията. **Data, Methods, Platforms** показва районите, Building Class и четирите сензорни слоя. Втората стъпка показва **Temp predict 9pm 20180822** (`temperature-prediction`) и сградите по клас. Температурните клетки се оцветяват по `Temp_float` и се зареждат на страници от ArcGIS. Стъпки 3–8 се активират при добавяне на техния списък `layers`. Празен списък показва базовата карта и сградите с оригиналния им изглед.
- Сензорните слоеве използват ArcGIS `LabSensors/FeatureServer`. `air` е слой 3, `lidar` е слой 2, `noise` е слой 1, а `pedestrian` е слой 0. Картата и легендата използват приложените PNG икони от `assets/sensors/`. Имената идват от полето `object`. Етикетите на Noise и Pedestrian се виждат при приближаване.
- `?slide=sensors` показва четирите сензорни слоя заедно. Всеки слой има и собствен преглед с неговото ID в адреса, например `?slide=air` или `?slide=building-class`.
- `?slide=districts` показва административните граници от ArcGIS `boundaries_disctricts_20260407` с червени контури и бели имена от `obns_lat`. За комбиниран слайд добави `districts` в списъка `layers`.
- `solar` е локален набор от 3D Tiles в `assets/solar/`, преобразуван от [оригиналния ArcGIS SceneServer](https://tiles-eu1.arcgis.com/XYGfXK4rEYwaj5A0/arcgis/rest/services/cc_5m_moved_7801_colored/SceneServer/layers/0). Запазени са RGB цветовете от източника. Височините са преобразувани от EGM96 към WGS84 с отместване +2 m. Cesium визуализира точките с размер 3 px.
- Непрозрачността на температурната мрежа се задава чрез `layerOptions["temperature-prediction"].opacity` за втория слайд в `slides.js`. Началната стойност е `0.50`, а диапазонът е от `0` до `1`.

## Time layer datasets

Третата стъпка `?slide=time-layer` пренася функционалността на `cesium_timebased`: от `Time layer dataset` се избира между `Summer surface temperature` (2016–2025) и `10 m wind speed` (почасовите WRF кадри). И двата режима имат Play/Pause, времеви плъзгач, цветова легенда, Raster min/mean/max история и избор на точка от картата за Selected point история. Готовите PNG tile cache файлове са локални в `assets/time-layer/cache/`, така че не са нужни QGIS, Conda или Python.

Кадрите използват оригиналната EPSG:3857 решетка, пикселните граници от NetCDF, прозрачен NoData и фиксираната CIELAB скала от ArcGIS. Слайдът използва запазения изглед, подложката World Imagery и осветление на релефа с фиксирано дневно слънце. Браузърът зарежда готовите PNG кадри и не отваря оригиналния NetCDF.

За повторно генериране от папка `new-project` с PowerShell:

```powershell
$wrfSource = (Get-ChildItem ./external_files -Filter '*reproj3857.nc').FullName
Push-Location ./tools/wrf
npm.cmd ci
npm.cmd run build -- $wrfSource ../../assets/wrf/T2_C
Pop-Location
```

По подразбиране инструментът използва `tools/wrf/t2-c.json`. Подай друг профил като трети аргумент на `build` за друга почасова растерна променлива със същата решетка. Профилът задава името на променливата, диапазона и цветовата интерполация. Манифестът записва геореференцията, часовете, NoData броя за всеки кадър и SHA-256 на оригиналния файл.
