import { FeatureLike } from 'ol/Feature';
import OpenLayersMap from 'ol/Map';
import { unByKey } from 'ol/Observable';
import GeoJSON from 'ol/format/GeoJSON';
import VectorImage from 'ol/layer/VectorImage';
import VectorSource from 'ol/source/Vector';
import { Fill, Stroke, Style } from 'ol/style';
import { ReplaySubject } from 'rxjs';
import { map as rxjsmap, first } from 'rxjs/operators';

import {
  MapLayerRegistryItem,
  MapLayerOptions,
  PanelData,
  GrafanaTheme2,
  PluginState,
  EventBus,
  DataFrame,
} from '@grafana/data';
import { ComparisonOperation } from '@grafana/schema';
import { findField } from 'app/features/dimensions/utils';

import { GeomapStyleRulesEditor } from '../../editor/GeomapStyleRulesEditor';
import { StyleEditor } from '../../editor/StyleEditor';
import { polyStyle } from '../../style/markers';
import { defaultStyleConfig, StyleConfig, StyleConfigState } from '../../style/types';
import { getStyleConfigState } from '../../style/utils';
import { FeatureRuleConfig, FeatureStyleConfig } from '../../types';
import { checkFeatureMatchesStyleRule } from '../../utils/checkFeatureMatchesStyleRule';
import { getLayerPropertyInfo } from '../../utils/getFeatures';
import { getStyleDimension, getPublicGeoJSONFiles } from '../../utils/utils';


export interface GeoJSONQueryConfig {
  // Field containing geojson data as string
  geojsonField: string;

  // The default style (applied if no rules match)
  style: StyleConfig;

  // Pick style based on a rule
  rules: FeatureStyleConfig[];
  idField?: string;
}

const defaultOptions: GeoJSONQueryConfig = {
  geojsonField: '',
  rules: [],
  style: defaultStyleConfig,
};

interface StyleCheckerState {
  state: StyleConfigState;
  poly?: Style | Style[];
  point?: Style | Style[];
  rule?: FeatureRuleConfig;
}

export const DEFAULT_STYLE_RULE: FeatureStyleConfig = {
  style: defaultStyleConfig,
  check: {
    property: '',
    operation: ComparisonOperation.EQ,
    value: '',
  },
};

// Default configuration with tooltip support enabled
export const defaultGeoJSONQueryConfig: MapLayerOptions<GeoJSONQueryConfig> = {
  type: 'geojson-query',
  name: 'GeoJSON Query',
  config: defaultOptions,
  tooltip: true,
};

export const geoJSONQueryLayer: MapLayerRegistryItem<GeoJSONQueryConfig> = {
  id: 'geojson-query',
  name: 'GeoJSON Query',
  description: 'Style geojson data from query results',
  isBaseMap: false,
  state: PluginState.alpha,
  

  /**
   * Function that configures transformation and returns a transformer
   * @param map
   * @param options
   * @param theme
   */
  create: async (map: OpenLayersMap, options: MapLayerOptions<GeoJSONQueryConfig>, eventBus: EventBus, theme: GrafanaTheme2) => {
    console.log('[GeoJSONQuery] ===== LAYER CREATE FUNCTION CALLED =====', {
      mapId: map.getTarget(),
      mapSize: map.getSize(),
      mapView: map.getView().getCenter(),
      mapLayersCount: map.getLayers().getLength(),
      options: options,
      timestamp: new Date().toISOString()
    });
    
    const config = { ...defaultOptions, ...options.config };
    
    console.log('[GeoJSONQuery] Layer create function called', {
      mapId: map.getTarget(),
      mapSize: map.getSize(),
      mapView: map.getView().getCenter(),
      mapLayersCount: map.getLayers().getLength(),
      options: options,
      config: config,
      theme: theme,
      timestamp: new Date().toISOString()
    });
    
    console.log('[GeoJSONQuery] Layer registration details', {
      layerId: 'geojson-query',
      layerName: 'GeoJSON Query',
      isBaseMap: false,
      state: 'alpha'
    });

    // Create source without URL initially - will be set based on config
    const source = new VectorSource({
      format: new GeoJSON(),
    });

    const features = new ReplaySubject<FeatureLike[]>();

    // Function to update feature properties for tooltip support
    const updateFeatureProperties = (frame?: DataFrame) => {
      updateFeaturePropertiesForTooltip(source, frame, config.idField, idToIdx);
    };

    // Function to load geojson from query data
    const loadGeoJSONFromQuery = (frame?: DataFrame) => {
      console.log('[GeoJSONQuery] loadGeoJSONFromQuery called', { 
        hasFrame: !!frame, 
        geojsonField: config.geojsonField 
      });
      
      if (!frame || !config.geojsonField) {
        console.log('[GeoJSONQuery] Skipping query load - missing frame or geojsonField', {
          hasFrame: !!frame,
          geojsonField: config.geojsonField
        });
        return;
      }
      
      const geojsonField = findField(frame, config.geojsonField);
      console.log('[GeoJSONQuery] Found geojson field', {
        fieldName: config.geojsonField,
        fieldFound: !!geojsonField,
        fieldType: geojsonField?.type,
        valuesLength: geojsonField?.values.length,
        // Add detailed field information
        allFields: frame.fields.map(f => ({
          name: f.name,
          displayName: f.displayName || f.name,
          type: f.type,
          valuesLength: f.values.length
        }))
      });
      
      if (geojsonField && geojsonField.values.length > 0) {
        const geojsonString = geojsonField.values[0] as string;
        console.log('[GeoJSONQuery] Processing geojson string', {
          stringLength: geojsonString?.length,
          stringPreview: geojsonString?.substring(0, 100) + (geojsonString?.length > 100 ? '...' : '')
        });
        
        try {
          const geojsonData = JSON.parse(geojsonString);
          console.log('[GeoJSONQuery] Successfully parsed geojson', {
            type: geojsonData?.type,
            featuresCount: geojsonData?.features?.length,
            crs: geojsonData?.crs
          });
          
          // Determine the source projection based on CRS
          let dataProjection = 'EPSG:4326'; // Default to WGS84
          if (geojsonData.crs && geojsonData.crs.properties && geojsonData.crs.properties.name) {
            const crsName = geojsonData.crs.properties.name;
            console.log('[GeoJSONQuery] Detected CRS:', crsName);
            
            if (crsName === 'EPSG:4258') {
              dataProjection = 'EPSG:4258'; // ETRS89
              console.log('[GeoJSONQuery] Using ETRS89 projection for data');
            } else if (crsName === 'EPSG:4326') {
              dataProjection = 'EPSG:4326'; // WGS84
              console.log('[GeoJSONQuery] Using WGS84 projection for data');
            }
          }
          
          const newFeatures = new GeoJSON().readFeatures(geojsonData, {
            dataProjection: dataProjection,
            featureProjection: 'EPSG:3857'
          });
          
          // Generate IDs for features that don't have them
          newFeatures.forEach((feature, index) => {
            if (!feature.getId()) {
              const description = feature.get('description');
              const intentId = feature.get('intent_id');
              
              let generatedId;
              if (description && description.trim()) {
                // Use description as ID (sanitized for safety)
                generatedId = description.trim()
                  .replace(/[^a-zA-Z0-9\s-_]/g, '') // Remove special characters
                  .replace(/\s+/g, '_') // Replace spaces with underscores
                  .substring(0, 100); // Limit length
              } else if (intentId) {
                // Fallback to intent_id
                generatedId = `intent_${intentId}`;
              } else {
                // Last resort: index-based
                generatedId = `feature_${index}`;
              }
              
              feature.setId(generatedId);
              console.log('[GeoJSONQuery] Generated feature ID', {
                index: index,
                generatedId: generatedId,
                description: description,
                intentId: intentId,
                hasDescription: !!description,
                hasIntentId: !!intentId
              });
            }
          });
          
          console.log('[GeoJSONQuery] Successfully created features', {
            featuresCount: newFeatures.length,
            featuresWithIds: newFeatures.map(f => ({
              id: f.getId(),
              hasId: !!f.getId(),
              intentId: f.get('intent_id')
            }))
          });
          
          source.clear();
          source.addFeatures(newFeatures);
          features.next(source.getFeatures());
          
          console.log('[GeoJSONQuery] Successfully loaded geojson from query', {
            featuresAdded: newFeatures.length,
            sourceFeaturesCount: source.getFeatures().length,
            sourceState: source.getState(),
            featuresDetails: newFeatures.map(f => ({
              id: f.getId(),
              geometryType: f.getGeometry()?.getType(),
              properties: Object.keys(f.getProperties()),
              intentId: f.get('intent_id'),
              description: f.get('description')
            }))
          });
          
          // Apply current data to newly loaded features
          if (currentFrame) {
            updateFeatureProperties(currentFrame);
          }
          
          // Force style function execution for newly loaded features
          console.log('[GeoJSONQuery] Manually triggering style function for newly loaded features');
          newFeatures.forEach((feature, index) => {
            console.log(`[GeoJSONQuery] Triggering style for new feature ${index}`, {
              id: feature.getId(),
              geometryType: feature.getGeometry()?.getType(),
              hasGeometry: !!feature.getGeometry()
            });
            // Force style recalculation
            feature.changed();
          });
          
          // Force layer refresh
          console.log('[GeoJSONQuery] Forcing layer refresh after feature loading');
          vectorLayer.changed();
        } catch (error) {
          console.error('[GeoJSONQuery] Failed to parse geojson from query:', error);
          console.error('[GeoJSONQuery] Geojson string that failed:', geojsonString);
        }
      } else {
        console.log('[GeoJSONQuery] No geojson field found or field has no values', {
          fieldFound: !!geojsonField,
          valuesLength: geojsonField?.values.length
        });
      }
    };

    // This layer only supports query-based GeoJSON loading

    const styles: StyleCheckerState[] = [];
    if (config.rules) {
      console.log('[GeoJSONQuery] Processing style rules', {
        rulesCount: config.rules.length,
        rules: config.rules.map((r, i) => ({
          index: i,
          hasStyle: !!r.style,
          hasCheck: !!r.check,
          check: r.check
        }))
      });
      
      for (const r of config.rules) {
        if (r.style) {
          const s = await getStyleConfigState(r.style);
          styles.push({
            state: s,
            rule: r.check,
          });
          console.log('[GeoJSONQuery] Added rule style', {
            rule: r.check,
            state: s,
            base: s.base,
            hasMaker: !!s.maker,
            hasFields: !!s.fields
          });
        }
      }
    }

    const s = await getStyleConfigState(config.style);
    styles.push({
      state: s,
    });
    
    console.log('[GeoJSONQuery] Styles initialized', {
      totalStyles: styles.length,
      defaultStyle: {
        base: s.base,
        hasMaker: !!s.maker,
        hasFields: !!s.fields,
        dims: s.dims
      },
      allStyles: styles.map((style, i) => ({
        index: i,
        hasRule: !!style.rule,
        base: style.state.base,
        hasMaker: !!style.state.maker,
        hasFields: !!style.state.fields
      }))
    });


    const style = await getStyleConfigState(config.style);
    const idToIdx = new Map<string, number>();
    let currentFrame: DataFrame | undefined = undefined;

    const vectorLayer = new VectorImage({
      source,
      style: (feature: FeatureLike, resolution: number) => {
        try {
          console.log('[GeoJSONQuery] Style function called', {
            featureId: feature.getId(),
            geometryType: feature.getGeometry()?.getType(),
            hasGeometry: !!feature.getGeometry(),
            featureProperties: Object.keys(feature.getProperties()),
            resolution: resolution,
            timestamp: new Date().toISOString()
          });

        const featureId = feature.getId();
        const idx = featureId != null ? idToIdx.get(String(featureId)) : undefined;
        const dims = style.dims;

        console.log('[GeoJSONQuery] Style processing', {
          featureId: featureId,
          idx: idx,
          hasDims: !!dims,
          dimsColor: dims?.color ? 'present' : 'missing',
          styleBase: style.base,
          idToIdxSize: idToIdx.size
        });

        if (idx !== undefined && dims) {
          const dataStyle = new Style({
            fill: new Fill({ color: dims.color?.get(idx) }),
            stroke: new Stroke({ color: style.base.color, width: style.base.lineWidth ?? 1 }),
          });
          console.log('[GeoJSONQuery] Returning data-driven style', {
            featureId: featureId,
            color: dims.color?.get(idx),
            strokeColor: style.base.color,
            strokeWidth: style.base.lineWidth ?? 1
          });
          return dataStyle;
        }

        const featureType = feature.getGeometry()?.getType();
        const isPoint = featureType === 'Point' || featureType === 'MultiPoint';
        const isPolygon = featureType === 'Polygon' || featureType === 'MultiPolygon';
        const isLine = featureType === 'LineString' || featureType === 'MultiLineString';

        console.log('[GeoJSONQuery] Geometry type analysis', {
          featureType: featureType,
          isPoint: isPoint,
          isPolygon: isPolygon,
          isLine: isLine,
          stylesCount: styles.length
        });

        for (let i = 0; i < styles.length; i++) {
          const check = styles[i];
          console.log(`[GeoJSONQuery] Processing style ${i}`, {
            hasRule: !!check.rule,
            hasFields: !!check.state.fields,
            hasMaker: !!check.state.maker,
            baseStyle: check.state.base,
            hasPointStyle: !!check.point,
            hasPolyStyle: !!check.poly
          });

          if (check.rule && !checkFeatureMatchesStyleRule(check.rule, feature)) {
            console.log(`[GeoJSONQuery] Style ${i} rule did not match`, {
              rule: check.rule,
              featureProperties: feature.getProperties()
            });
            continue;
          }

          // Support dynamic values
          if (check.state.fields) {
            const values = { ...check.state.base };
            const { text } = check.state.fields;

            if (text) {
              values.text = `${feature.get(text)}`;
            }
            
            console.log(`[GeoJSONQuery] Style ${i} dynamic values`, {
              values: values,
              isPoint: isPoint,
              willUseMaker: isPoint,
              willUsePolyStyle: !isPoint
            });

            if (isPoint) {
              const pointStyle = check.state.maker(values);
              console.log(`[GeoJSONQuery] Returning point style from maker`, {
                style: pointStyle,
                values: values
              });
              return pointStyle;
            }
            const polyStyleResult = polyStyle(values);
            console.log(`[GeoJSONQuery] Returning poly style from dynamic values`, {
              style: polyStyleResult,
              values: values
            });
            return polyStyleResult;
          }

          // Lazy create the style object
          if (isPoint) {
            if (!check.point) {
              console.log(`[GeoJSONQuery] Creating point style for style ${i}`, {
                base: check.state.base,
                maker: check.state.maker
              });
              check.point = check.state.maker(check.state.base);
            }
            console.log(`[GeoJSONQuery] Returning cached point style for style ${i}`, {
              style: check.point
            });
            return check.point;
          }

          if (!check.poly) {
            console.log(`[GeoJSONQuery] Creating poly style for style ${i}`, {
              base: check.state.base
            });
            check.poly = polyStyle(check.state.base);
          }
          console.log(`[GeoJSONQuery] Returning cached poly style for style ${i}`, {
            style: check.poly,
            base: check.state.base
          });
          return check.poly;
        }
        
        console.error('[GeoJSONQuery] No style returned - this should not happen!', {
          featureId: featureId,
          featureType: featureType,
          stylesCount: styles.length,
          styles: styles.map((s, i) => ({
            index: i,
            hasRule: !!s.rule,
            hasFields: !!s.state.fields,
            base: s.state.base
          }))
        });
        return undefined; // unreachable
        } catch (error) {
          console.error('[GeoJSONQuery] Error in style function:', error, {
            featureId: feature.getId(),
            geometryType: feature.getGeometry()?.getType(),
            error: error
          });
          return undefined;
        }
      },
    });

    // Debug: Check if style function is properly attached
    console.log('[GeoJSONQuery] Layer created with style function', {
      layerType: vectorLayer.constructor.name,
      hasStyleFunction: typeof vectorLayer.getStyle() === 'function',
      styleFunction: vectorLayer.getStyle(),
      sourceFeaturesCount: source.getFeatures().length,
      layerVisible: vectorLayer.getVisible(),
      layerOpacity: vectorLayer.getOpacity(),
      layerZIndex: vectorLayer.getZIndex()
    });
    
    // Debug: Check if there are any default styles
    console.log('[GeoJSONQuery] Layer style configuration', {
      styleFunction: vectorLayer.getStyle(),
      layerVisible: vectorLayer.getVisible(),
      layerOpacity: vectorLayer.getOpacity(),
      layerZIndex: vectorLayer.getZIndex()
    });

    return {
        init: () => {
          console.log('[GeoJSONQuery] ===== LAYER INIT FUNCTION CALLED =====', {
            sourceFeaturesCount: source.getFeatures().length,
            sourceState: source.getState(),
            layerType: vectorLayer.constructor.name,
            timestamp: new Date().toISOString()
          });
          
          console.log('[GeoJSONQuery] Layer init called', {
            sourceFeaturesCount: source.getFeatures().length,
            sourceState: source.getState(),
            layerType: vectorLayer.constructor.name,
            timestamp: new Date().toISOString()
          });
          
          // Add source change listener for debugging
          source.on('change', () => {
            console.log('[GeoJSONQuery] Source changed', {
              state: source.getState(),
              featuresCount: source.getFeatures().length,
              timestamp: new Date().toISOString()
            });
          });
          
          // Add layer change listener for debugging
          vectorLayer.on('change', () => {
            console.log('[GeoJSONQuery] Layer changed', {
              visible: vectorLayer.getVisible(),
              opacity: vectorLayer.getOpacity(),
              zIndex: vectorLayer.getZIndex(),
              timestamp: new Date().toISOString()
            });
          });
          
          console.log('[GeoJSONQuery] Layer init completed', {
            layerId: vectorLayer.get('id') || 'no-id',
            layerVisible: vectorLayer.getVisible(),
            layerOpacity: vectorLayer.getOpacity(),
            layerZIndex: vectorLayer.getZIndex(),
            sourceFeaturesCount: source.getFeatures().length,
            timestamp: new Date().toISOString()
          });
          
          // Force a style refresh to trigger style function
          console.log('[GeoJSONQuery] Forcing style refresh');
          vectorLayer.changed();
          
          // Force style function execution for all features
          console.log('[GeoJSONQuery] Manually triggering style function for all features');
          const allFeatures = source.getFeatures();
          const styleFunction = vectorLayer.getStyle();
          
          console.log('[GeoJSONQuery] Style function details', {
            hasStyleFunction: typeof styleFunction === 'function',
            styleFunctionType: typeof styleFunction,
            styleFunction: styleFunction
          });
          
          // DIRECT STYLE FUNCTION TESTING
          console.log('[GeoJSONQuery] ===== DIRECT STYLE FUNCTION TESTING =====');
          allFeatures.forEach((feature, index) => {
            console.log(`[GeoJSONQuery] Testing style function for feature ${index}`, {
              id: feature.getId(),
              geometryType: feature.getGeometry()?.getType(),
              hasGeometry: !!feature.getGeometry()
            });
            
            // Test: Manually call the style function
            if (typeof styleFunction === 'function') {
              console.log(`[GeoJSONQuery] Manually calling style function for feature ${index}`);
              try {
                const result = styleFunction(feature);
                console.log(`[GeoJSONQuery] Style function result for feature ${index}:`, result);
                
                // Check if result is valid
                if (result) {
                  console.log(`[GeoJSONQuery] Style result details for feature ${index}:`, {
                    hasFill: !!result.getFill(),
                    hasStroke: !!result.getStroke(),
                    fillColor: result.getFill()?.getColor(),
                    strokeColor: result.getStroke()?.getColor(),
                    strokeWidth: result.getStroke()?.getWidth()
                  });
                } else {
                  console.warn(`[GeoJSONQuery] Style function returned null/undefined for feature ${index}`);
                }
              } catch (error) {
                console.error(`[GeoJSONQuery] Error calling style function for feature ${index}:`, error);
              }
            }
            
            // Force style recalculation
            feature.changed();
          });
          
          // Check if style function is properly attached
          console.log('[GeoJSONQuery] ===== STYLE FUNCTION ATTACHMENT CHECK =====');
          console.log('[GeoJSONQuery] Layer style method:', typeof vectorLayer.getStyle);
          console.log('[GeoJSONQuery] Layer style result:', vectorLayer.getStyle());
          console.log('[GeoJSONQuery] Layer style function type:', typeof vectorLayer.getStyle());
          
          // Try to get the style function directly from the layer
          const layerStyle = vectorLayer.getStyle();
          if (typeof layerStyle === 'function') {
            console.log('[GeoJSONQuery] Style function is properly attached to layer');
          } else {
            console.error('[GeoJSONQuery] Style function is NOT properly attached to layer!', {
              layerStyle: layerStyle,
              layerStyleType: typeof layerStyle
            });
          }
          
          // Add a small delay and check if style function gets called
          setTimeout(() => {
            console.log('[GeoJSONQuery] Post-init check', {
              sourceFeaturesCount: source.getFeatures().length,
              layerVisible: vectorLayer.getVisible(),
              layerOpacity: vectorLayer.getOpacity(),
              features: source.getFeatures().map(f => ({
                id: f.getId(),
                geometryType: f.getGeometry()?.getType()
              }))
            });
          }, 100);
          
          return vectorLayer;
        },
      update: (data: PanelData) => {
        console.log('[GeoJSONQuery] ===== UPDATE FUNCTION CALLED =====', {
          hasData: !!data,
          seriesCount: data.series?.length,
          geojsonField: config.geojsonField,
          timestamp: new Date().toISOString()
        });
        
        console.log('[GeoJSONQuery] Update called', {
          hasData: !!data,
          seriesCount: data.series?.length,
          geojsonField: config.geojsonField
        });
        
        const frame = data.series[0];
        if (frame) {
          currentFrame = frame;
          
          console.log('[GeoJSONQuery] Processing frame', {
            frameLength: frame.length,
            fieldNames: frame.fields.map(f => f.name),
            fieldDisplayNames: frame.fields.map(f => f.displayName || f.name),
            fieldTypes: frame.fields.map(f => f.type),
            fieldValues: frame.fields.map(f => ({
              name: f.name,
              displayName: f.displayName || f.name,
              type: f.type,
              valuesLength: f.values.length,
              sampleValue: f.values[0]
            })),
            geojsonField: config.geojsonField
          });
          
          // Load geojson from query field
          if (config.geojsonField) {
            console.log('[GeoJSONQuery] Attempting to load geojson from query field');
            loadGeoJSONFromQuery(frame);
          } else {
            console.log('[GeoJSONQuery] No geojsonField specified, skipping query load');
          }
          
          // Update feature properties for tooltip support
          updateFeatureProperties(frame);
          
          // Update style dimensions for data-driven styling
          style.dims = getStyleDimension(frame, style, theme, config.style);
        } else {
          console.log('[GeoJSONQuery] No frame data available');
        }
        vectorLayer.changed();
      },
      registerOptionsUI: (builder) => {
        console.log('[GeoJSONQuery] Layer options UI being registered', {
          layerId: 'geojson-query',
          timestamp: new Date().toISOString()
        });
        
        // get properties for first feature to use as ui options
        const layerInfo = features.pipe(
          first(),
          rxjsmap((v) => getLayerPropertyInfo(v))
        );

        builder
          .addFieldNamePicker({
            path: 'config.geojsonField',
            name: 'GeoJSON Field',
            description: 'Field containing geojson data as string',
            settings: {
              required: true,
            },
          })
          .addFieldNamePicker({
            path: 'config.idField',
            name: 'ID Field',
          })
          .addCustomEditor({
            id: 'config.style',
            path: 'config.style',
            name: 'Default style',
            description: 'The style to apply when no rules above match',
            editor: StyleEditor,
            settings: {
              simpleFixedValues: true,
              layerInfo,
            },
            defaultValue: defaultOptions.style,
          })
          .addCustomEditor({
            id: 'config.rules',
            path: 'config.rules',
            name: 'Style rules',
            description: 'Apply styles based on feature properties',
            editor: GeomapStyleRulesEditor,
            settings: {
              features,
              layerInfo,
            },
            defaultValue: [],
          });
      },
    };
  },
  defaultOptions,
};

/**
 * Helper function to update feature properties for tooltip support
 * @param source - OpenLayers vector source containing features
 * @param frame - DataFrame containing the data
 * @param idField - Field name to use for matching feature IDs
 * @param idToIdx - Map to store ID to row index mappings
 */
export function updateFeaturePropertiesForTooltip(
  source: VectorSource,
  frame: DataFrame | undefined,
  idField: string | undefined,
  idToIdx: Map<string, number>
): void {
  console.log('[GeoJSONQuery] updateFeaturePropertiesForTooltip called', {
    hasFrame: !!frame,
    idField: idField,
    sourceFeaturesCount: source.getFeatures().length
  });
  
  if (!frame || !idField) {
    console.log('[GeoJSONQuery] Skipping feature property update', {
      hasFrame: !!frame,
      idField: idField
    });
    return;
  }
  
  const field = findField(frame, idField);
  console.log('[GeoJSONQuery] Found ID field', {
    fieldName: idField,
    fieldFound: !!field,
    fieldType: field?.type,
    valuesLength: field?.values.length
  });
  
  if (field) {
    idToIdx.clear();
    field.values.forEach((v, i) => idToIdx.set(String(v), i));
    
    console.log('[GeoJSONQuery] Updated ID mapping', {
      mappingSize: idToIdx.size,
      sampleIds: Array.from(idToIdx.keys()).slice(0, 5)
    });
    
    let updatedCount = 0;
    source.forEachFeature((feature) => {
      const featureId = feature.getId();
      if (featureId != null) {
        const rowIndex = idToIdx.get(String(featureId));
        if (rowIndex !== undefined) {
          // Set tooltip properties without overwriting existing GeoJSON properties
          feature.set('frame', frame);
          feature.set('rowIndex', rowIndex);
          updatedCount++;
        }
      }
    });
    
    console.log('[GeoJSONQuery] Updated feature properties', {
      totalFeatures: source.getFeatures().length,
      updatedFeatures: updatedCount
    });
  } else {
    console.log('[GeoJSONQuery] ID field not found in frame', {
      idField: idField,
      availableFields: frame.fields.map(f => f.name)
    });
  }
}
