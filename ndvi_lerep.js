/****  NDVI Diagnostics — Desa Wisata Lerep (Sentinel-2 SR Harmonized)
 *   Purpose : Multi-year dry-season NDVI composite + simple NDVI class map
 *   Dataset : COPERNICUS/S2_SR_HARMONIZED (10 m)
 *   Window  : Dry season (May–Oct) per year
 *   Notes   : Replace AOI_ASSET_ID with your actual GEE Asset ID.
 *            Exports go to Google Drive (GeoTIFF).
 ****/

// =====================
// 0) USER SETTINGS
// =====================

// (A) STUDY AREA (AOI) — REPLACE THIS WITH YOUR REAL ASSET ID
// Example: "users/faisallerep/lerep_boundary"
var AOI_ASSET_ID = "projects/solar-solution-460002-n8/assets/lerep_aoi";  // <<<<<< EDIT THIS
var aoi = ee.FeatureCollection(AOI_ASSET_ID);

// (B) YEARS TO PROCESS
var years = [2015, 2020, 2025]; // edit as needed

// (C) DRY SEASON WINDOW (Indonesia typical)
var startMonth = 5;  // May
var startDay   = 1;
var endMonth   = 10; // Oct
var endDay     = 31;

// (D) EXPORT SETTINGS
var exportToDrive = true;  // set false if you only want preview
var exportScale = 10;      // Sentinel-2 native resolution (m)

// =====================
// 1) SENTINEL-2 SR HARMONIZED + CLOUD MASK
// =====================

var s2sr = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED");

// Cloud mask using SCL (Scene Classification Layer) + QA60 (cloud/cirrus bits)
function maskS2SR(img) {
  var scl = img.select("SCL");
  // SCL classes to mask out:
  // 0 NO_DATA, 1 SATURATED/DEFECTIVE, 3 CLOUD_SHADOW, 8 CLOUD_MEDIUM_PROB,
  // 9 CLOUD_HIGH_PROB, 10 THIN_CIRRUS, 11 SNOW/ICE
  var sclMask = scl.neq(0)
    .and(scl.neq(1))
    .and(scl.neq(3))
    .and(scl.neq(8))
    .and(scl.neq(9))
    .and(scl.neq(10))
    .and(scl.neq(11));

  // QA60 cloud mask (bit 10 = clouds, bit 11 = cirrus)
  var qa = img.select("QA60");
  var cloudBitMask  = 1 << 10;
  var cirrusBitMask = 1 << 11;
  var qaMask = qa.bitwiseAnd(cloudBitMask).eq(0)
    .and(qa.bitwiseAnd(cirrusBitMask).eq(0));

  return img.updateMask(sclMask).updateMask(qaMask);
}

// NDVI calculation (B8 NIR, B4 Red)
function addNDVI(img) {
  var ndvi = img.normalizedDifference(["B8", "B4"]).rename("NDVI");
  return img.addBands(ndvi);
}

// =====================
// 2) BUILD YEARLY DRY-SEASON NDVI COMPOSITES
// =====================

function yearlyNdviComposite(year) {
  year = ee.Number(year);

  var start = ee.Date.fromYMD(year, startMonth, startDay);
  var end   = ee.Date.fromYMD(year, endMonth, endDay);

  var col = s2sr
    .filterBounds(aoi)
    .filterDate(start, end)
    // Optional: a mild pre-filter (keep; doesn’t guarantee cloud-free)
    .filter(ee.Filter.lte("CLOUDY_PIXEL_PERCENTAGE", 60))
    .map(maskS2SR)
    .map(addNDVI);

  // Median composite of NDVI band only (robust to residual clouds)
  var ndviMed = col.select("NDVI").median().clip(aoi)
    .set({
      "year": year,
      "start": start.format("YYYY-MM-dd"),
      "end": end.format("YYYY-MM-dd"),
      "collection": "COPERNICUS/S2_SR_HARMONIZED",
      "window": "Dry season (May–Oct)"
    });

  return ndviMed;
}

// Build an ImageCollection of composites
var ndviComposites = ee.ImageCollection.fromImages(
  years.map(function(y) { return yearlyNdviComposite(y); })
);

// =====================
// 3) NDVI CLASSIFICATION (SIMPLE THRESHOLDS)
// =====================
// Class codes:
// 1: Very Low (<0.2)
// 2: Low (0.2–<0.4)
// 3: Moderate (0.4–<0.6)
// 4: High (>=0.6)

function classifyNdvi(ndviImg) {
  var ndvi = ndviImg.select("NDVI");
  var cls = ee.Image(0)
    .where(ndvi.lt(0.2), 1)
    .where(ndvi.gte(0.2).and(ndvi.lt(0.4)), 2)
    .where(ndvi.gte(0.4).and(ndvi.lt(0.6)), 3)
    .where(ndvi.gte(0.6), 4)
    .rename("NDVI_Class")
    .clip(aoi);

  return cls.set(ndviImg.toDictionary(["year", "start", "end", "collection", "window"]));
}

var ndviClasses = ndviComposites.map(classifyNdvi);

// =====================
// 4) QUICK PREVIEW (MAP)
// =====================

Map.centerObject(aoi, 13);
Map.addLayer(aoi, {}, "AOI (Lerep)");

// NDVI visualization
var ndviVis = {min: 0, max: 1};

// Class visualization (legend by value)
var clsVis = {min: 1, max: 4, palette: ["#d73027", "#fc8d59", "#fee08b", "#1a9850"]};

// Add layers for each year
years.forEach(function(y) {
  var ndviImg = ee.Image(ndviComposites.filter(ee.Filter.eq("year", y)).first());
  var clsImg  = ee.Image(ndviClasses.filter(ee.Filter.eq("year", y)).first());

  Map.addLayer(ndviImg, ndviVis, "NDVI Median (Dry Season) " + y, false);
  Map.addLayer(clsImg, clsVis, "NDVI Class " + y, true);
});

// =====================
// 5) EXPORTS (GOOGLE DRIVE)
// =====================

if (exportToDrive) {
  years.forEach(function(y) {
    var ndviImg = ee.Image(ndviComposites.filter(ee.Filter.eq("year", y)).first());
    var clsImg  = ee.Image(ndviClasses.filter(ee.Filter.eq("year", y)).first());

    // NDVI export
    Export.image.toDrive({
      image: ndviImg,
      description: "NDVI_Lerep_DrySeason_" + y,
      folder: "GEE_Exports",     // change if needed
      fileNamePrefix: "NDVI_Lerep_DrySeason_" + y,
      region: aoi.geometry(),
      scale: exportScale,
      maxPixels: 1e13
    });

    // NDVI class export
    Export.image.toDrive({
      image: clsImg,
      description: "NDVIClass_Lerep_" + y,
      folder: "GEE_Exports",     // change if needed
      fileNamePrefix: "NDVIClass_Lerep_" + y,
      region: aoi.geometry(),
      scale: exportScale,
      maxPixels: 1e13
    });
  });
}

// =====================
// 6) OPTIONAL: SUMMARY STATS (MEAN NDVI IN AOI PER YEAR)
// =====================

var stats = ndviComposites.map(function(img) {
  var y = img.get("year");
  var meanNdvi = img.reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: aoi.geometry(),
    scale: exportScale,
    maxPixels: 1e13
  }).get("NDVI");

  return ee.Feature(null, {
    year: y,
    mean_ndvi: meanNdvi,
    start: img.get("start"),
    end: img.get("end")
  });
});

print("Mean NDVI per year (AOI)", ee.FeatureCollection(stats));
