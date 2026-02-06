// =============================================
// Village-Scale NDVI Diagnostics – Desa Wisata Lerep
// Sentinel-2 Dry Season Composite (May–October)
// =============================================

// Load Area of Interest (replace with your asset)
var aoi = ee
  .FeatureCollection("projects/solar-solution-460002-n8/assets/desa_smg")
  .filter(ee.Filter.eq("NAMOBJ", "Lerep"));

// ---------------------------------------------
// Cloud masking for Sentinel-2 SR
// ---------------------------------------------
function maskCloudSentinel(image) {
  var scl = image.select("SCL");

  var mask = scl
    .neq(3)
    .and(scl.neq(8))
    .and(scl.neq(9))
    .and(scl.neq(10))
    .and(scl.neq(11));

  return image
    .updateMask(mask)
    .divide(10000)
    .copyProperties(image, ["system:time_start"]);
}

// ---------------------------------------------
// NDVI calculation
// ---------------------------------------------
function addNDVI(image) {
  var ndvi = image.normalizedDifference(["B8", "B4"]).rename("NDVI");
  return image.addBands(ndvi);
}

// ---------------------------------------------
// Yearly dry-season NDVI composite (May–October)
// ---------------------------------------------
function yearlyNDVI(year) {
  year = ee.Number(year);

  var start = ee.Date.fromYMD(year, 5, 1);
  var end = ee.Date.fromYMD(year, 10, 31);

  var s2 = ee
    .ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
    .filterBounds(aoi)
    .filterDate(start, end)
    .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 20))
    .map(maskCloudSentinel)
    .map(addNDVI);

  var ndviComposite = s2.select("NDVI").median().clip(aoi).set("year", year);

  return ndviComposite;
}

// ---------------------------------------------
// NDVI classification
// ---------------------------------------------
function classifyNDVI(image) {
  var classified = image
    .expression(
      "(b('NDVI') < 0.2) ? 1" +
        ": (b('NDVI') < 0.4) ? 2" +
        ": (b('NDVI') < 0.6) ? 3" +
        ": 4",
    )
    .rename("NDVI_Class");

  return classified.set("year", image.get("year"));
}

// ---------------------------------------------
// Processing multiple years
// ---------------------------------------------
var years = ee.List([2015, 2020, 2025]);

var ndviSeries = ee.ImageCollection.fromImages(years.map(yearlyNDVI));

var classSeries = ndviSeries.map(classifyNDVI);

// ---------------------------------------------
// Visualization
// ---------------------------------------------
Map.centerObject(aoi, 13);
Map.addLayer(
  ndviSeries.first(),
  { min: 0, max: 0.8, palette: ["white", "green"] },
  "NDVI",
);
Map.addLayer(
  classSeries.first(),
  { min: 1, max: 4, palette: ["yellow", "lightgreen", "green", "darkgreen"] },
  "NDVI Class",
);

// ---------------------------------------------
// End of Script
// ---------------------------------------------

