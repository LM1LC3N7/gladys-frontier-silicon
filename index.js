// -----------------------------------------------------------------------------
// Entry point: SDK wiring only. Every handler is registered BEFORE connect(),
// and delegates to the FrontierApp (src/app.js).
//
// Environment variables provided by the Gladys supervisor, read by the SDK:
// GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { FrontierApp } from './src/app.js';
import { ACTIONS, SCENE_ACTIONS, WIDGETS } from './src/constants.js';

const gladys = new GladysIntegration();
const app = new FrontierApp({ gladys });

// --- Discovery and device lifecycle ----------------------------------------------
gladys.onScanRequest(() => app.publishDevices());
gladys.onDeviceCreated((device) => app.deviceCreated(device));
gladys.onDeviceUpdated((device) => app.deviceCreated(device));
gladys.onDeviceDeleted((device) => app.deviceDeleted(device));

// --- Commands (power, volume, mute, source, transport) ---------------------------
gladys.onSetValue((device, feature, value) => app.setValue(device, feature, value));

// --- Scene actions --------------------------------------------------------------
gladys.onSceneAction(SCENE_ACTIONS.PLAY_PRESET, (fields) => app.playPreset(fields));
gladys.onSceneAction(SCENE_ACTIONS.SET_MODE, (fields) => app.setMode(fields));
gladys.onSceneAction(SCENE_ACTIONS.NOW_PLAYING, (fields) => app.getNowPlaying(fields));

// --- Dashboard widget -----------------------------------------------------------
gladys.onWidgetGet(WIDGETS.RADIO, (request) => app.getWidget(WIDGETS.RADIO, request));
gladys.onWidgetAction(WIDGETS.RADIO, (actionKey, params, context) =>
  app.widgetAction(WIDGETS.RADIO, actionKey, params, context),
);

// --- Configuration screen buttons ----------------------------------------------
gladys.onAction(ACTIONS.TEST, () => app.testConnection());
gladys.onAction(ACTIONS.PRESETS, (fields) => app.listPresets(fields));

// --- Configuration changed by the user ----------------------------------------
gladys.onConfigUpdated((config) => {
  logger.info('Configuration updated: restarting');
  return app.start(config);
});

// --- Connection lifecycle ------------------------------------------------------
gladys.on('connected', async () => {
  try {
    await app.start(await gladys.getConfig());
  } catch (err) {
    logger.error('Start failed', err);
  }
});
gladys.on('disconnected', () => app.stop());
gladys.handleShutdown(() => app.stop());

logger.info('Starting the Frontier Silicon integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
