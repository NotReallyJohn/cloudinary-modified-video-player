import videojs from 'video.js';
import './components';
import plugins from './plugins';
import Utils from './utils';
import defaults from './config/defaults';
import Eventable from './mixins/eventable';
import ExtendedEvents from './extended-events';
import PlaylistWidget from './components/playlist/playlist-widget';
// #if (!process.env.WEBPACK_BUILD_LIGHT)
import qualitySelector from './components/qualitySelector/qualitySelector.js';
// #endif
import VideoSource from './plugins/cloudinary/models/video-source/video-source';
import { createElement, addEventListener } from './utils/dom';
import { isFunction, isString, noop, isPlainObject } from './utils/type-inference';
import {
  addMetadataTrack,
  extractOptions,
  getResolveVideoElement,
  overrideDefaultVideojsComponents
} from './video-player.utils';
import { FLUID_CLASS_NAME } from './video-player.const';
import {
  createInteractionAreaLayoutMessage,
  getInteractionAreaItem,
  getZoomTransformation,
  removeInteractionAreasContainer,
  setInteractionAreasContainer,
  setInteractionAreasContainerSize,
  shouldShowAreaLayoutMessage,
  updateInteractionAreasItem
} from './components/interaction-area/interaction-area.utils';
import {
  CLOSE_INTERACTION_AREA_LAYOUT_DELAY,
  INTERACTION_AREAS_CONTAINER_CLASS_NAME,
  TEMPLATE_INTERACTION_AREAS_VTT
} from './components/interaction-area/interaction-area.const';
import { throttle } from './utils/time';


// Register all plugins
Object.keys(plugins).forEach((key) => {
  videojs.registerPlugin(key, plugins[key]);
});

overrideDefaultVideojsComponents();

let _allowUsageReport = true;

class VideoPlayer extends Utils.mixin(Eventable) {

  static all(selector, ...args) {
    const nodeList = document.querySelectorAll(selector);
    const players = [];

    for (let i = 0; i < nodeList.length; i++) {
      players.push(new VideoPlayer(nodeList[i], ...args));
    }

    return players;
  }

  static allowUsageReport(bool) {
    if (bool === undefined) {
      return _allowUsageReport;
    }

    _allowUsageReport = !!bool;
    return _allowUsageReport;
  }

  static buildTextTrackObj (type, conf) {
    return {
      kind: type,
      label: conf.label,
      srclang: conf.language,
      default: !!(conf.default),
      src: conf.url
    };
  }

  constructor(elem, initOptions, ready) {
    super();

    this._isZoomed = false;
    this.unZoom = noop;
    this._setStaticInteractionAreas = null;
    this._playlistWidget = null;
    this.nbCalls = 0;
    this._firstPlayed = false;

    this.videoElement = getResolveVideoElement(elem);

    this.options = extractOptions(this.videoElement, initOptions);

    this._videojsOptions = this.options.videojsOptions;

    // Make sure to add 'video-js' class before creating videojs instance
    this.videoElement.classList.add('video-js');

    // Handle WebFont loading
    Utils.fontFace(this.videoElement, this.playerOptions);

    // Handle play button options
    Utils.playButton(this.videoElement, this._videojsOptions);

    // Dash plugin - available in full (not light) build only
    if (plugins.dashPlugin) {
      plugins.dashPlugin();
    }

    this.videojs = videojs(this.videoElement, this._videojsOptions);

    if (this._videojsOptions.muted) {
      this.videojs.volume(0.4);
    }

    if (this.playerOptions.fluid) {
      this.fluid(this.playerOptions.fluid);
    }

    /* global google */
    const loaded = {
      contribAdsLoaded: isFunction(this.videojs.ads),
      imaAdsLoaded: (typeof google === 'object' && typeof google.ima === 'object')
    };

    this._setCssClasses();
    this._initPlugins(loaded);
    this._initPlaylistWidget();
    this._initJumpButtons();
    this._setVideoJsListeners(ready);
  }

  _setVideoJsListeners(ready) {

    this.videojs.on('error', () => {
      const error = this.videojs.error();
      if (error) {
        const type = this.videojs.cloudinary.currentSourceType();
        if (error.code === 4 && (type === 'VideoSource' || type === 'AudioSource')) {
          this.videojs.error(null);
          Utils.handleCldError(this, this.playerOptions);
        } else {
          this.videojs.clearTimeout(this.reTryId);
        }
      }
    });

    this.videojs.on('play', () => {
      this.videojs.clearTimeout(this.reTryId);
    });

    this.videojs.on('canplaythrough', () => {
      this.videojs.clearTimeout(this.reTryId);
    });

    this.videojs.ready(() => {
      this._onReady();

      if (ready) {
        ready(this);
      }

      // on first play
      this.videojs.one('play', () => {
        this._firstPlayed = true;
        this._setInteractionAreaLayoutMessage();
      });

      this.videojs.on('sourcechanged', () => {
        this._firstPlayed && this._updateInteractionAreasTrack();
      });

      this.videojs.on('ended', () => {
        this.unZoom();
      });


      if (this._shouldSetResize()) {

        const setInteractionAreasContainerSize = throttle(this._setInteractionAreasContainerSize.bind(this), 100);

        this.videojs.on('fullscreenchange', () => {
          // waiting for fullscreen will end
          setTimeout(setInteractionAreasContainerSize, 100);
        });

        const resizeDestroy = addEventListener(window, 'resize', setInteractionAreasContainerSize, false);

        this.videojs.on('dispose', resizeDestroy);
      }
    });

    if (this.adsEnabled && Object.keys(this.playerOptions.ads).length > 0 && typeof this.videojs.ima === 'object') {
      if (this.playerOptions.ads.adsInPlaylist === 'first-video') {
        this.videojs.one('sourcechanged', () => {
          this.videojs.ima.playAd();
        });

      } else {
        this.videojs.on('sourcechanged', () => {
          this.videojs.ima.playAd();
        });
      }
    }

  }

  _initPlugins (loaded) {
    // #if (!process.env.WEBPACK_BUILD_LIGHT)
    this.adsEnabled = this._initIma(loaded);
    // #endif
    this._initAutoplay();
    this._initContextMenu();
    this._initPerSrcBehaviors();
    this._initCloudinary();
    this._initAnalytics();
    this._initFloatingPlayer();
    this._initColors();
    this._initTextTracks();
    this._initSeekThumbs();
  }

  _isInteractionAreasEnabled(enabled = false) {

    const interactionAreasConfig = this.getInteractionAreasConfig();

    return enabled || (interactionAreasConfig && interactionAreasConfig.enable);
  }

  _shouldSetResize() {
    return this._isInteractionAreasEnabled(this._setStaticInteractionAreas);
  }

  _setInteractionAreasContainerSize() {
    if (this._shouldSetResize()) {
      setInteractionAreasContainerSize(this.videojs, this.videoElement);
    }
  }

  _shouldShowAreaLayoutMessage() {
    return shouldShowAreaLayoutMessage(this.options.videojsOptions.interactionLayout);
  }

  _removeInteractionAreaLayoutMessage() {
    removeInteractionAreasContainer(this.videojs);
    this._updateInteractionAreasTrack();
    this._setStaticInteractionAreas && this._setStaticInteractionAreas();
    this.play();
  }

  _setInteractionAreaLayoutMessage() {
    if (!this._isInteractionAreasEnabled(this._setStaticInteractionAreas)) {
      return;
    }

    if (this._shouldShowAreaLayoutMessage()) {
      const showItAgainCheckbox = this.options.videojsOptions.interactionLayout && this.options.videojsOptions.interactionLayout.showItAgainCheckbox;
      this.pause();
      const removeInteractionAreaLayoutMessage = this._removeInteractionAreaLayoutMessage.bind(this);
      createInteractionAreaLayoutMessage(this.videojs, removeInteractionAreaLayoutMessage, showItAgainCheckbox);

      if (!showItAgainCheckbox) {
        setTimeout(removeInteractionAreaLayoutMessage, CLOSE_INTERACTION_AREA_LAYOUT_DELAY);
      }
    } else {
      this._removeInteractionAreaLayoutMessage();
    }
  }

  _isFullScreen() {
    return this.videojs.player().isFullscreen();
  }

  _updateInteractionAreasTrack() {
    this._currentTrack && this.videojs.removeRemoteTextTrack(this._currentTrack);

    if (!this._isInteractionAreasEnabled()) {
      return;
    }

    const interactionAreasConfig = this.getInteractionAreasConfig();

    const vttUrl = interactionAreasConfig.vttUrl || TEMPLATE_INTERACTION_AREAS_VTT[interactionAreasConfig.template];

    this.videojs.removeRemoteTextTrack(this._currentTrack);

    if (!this._isZoomed && interactionAreasConfig.enable && vttUrl) {
      this._currentTrack = addMetadataTrack(this.videojs, vttUrl);
      this.addCueListener(interactionAreasConfig, this._currentTrack);
    }
  }

  _initIma (loaded) {
    if (!loaded.contribAdsLoaded || !loaded.imaAdsLoaded) {
      if (this.playerOptions.ads) {
        if (!loaded.contribAdsLoaded) {
          console.log('contribAds is not loaded');
        }
        if (!loaded.imaAdsLoaded) {
          console.log('imaSdk is not loaded');
        }
      }

      return false;
    }

    if (!this.playerOptions.ads) {
      this.playerOptions.ads = {};
    }

    const opts = this.playerOptions.ads;

    if (Object.keys(opts).length === 0) {
      return false;
    }

    this.videojs.ima({
      id: this.el().id,
      adTagUrl: opts.adTagUrl,
      disableFlashAds: true,
      prerollTimeout: opts.prerollTimeout || 5000,
      postrollTimeout: opts.postrollTimeout || 5000,
      showCountdown: (opts.showCountdown !== false),
      adLabel: opts.adLabel || 'Advertisement',
      locale: opts.locale || 'en',
      autoPlayAdBreaks: (opts.autoPlayAdBreaks !== false),
      debug: true
    });

    return true;
  }

  setTextTracks (conf) {
    // remove current text tracks
    const currentTracks = this.videojs.remoteTextTracks();
    if (currentTracks) {
      for (let i = currentTracks.tracks_.length - 1; i >= 0; i--) {
        this.videojs.removeRemoteTextTrack(currentTracks.tracks_[i]);
      }
    }
    if (conf) {
      const tracks = Object.keys(conf);
      const allTracks = [];
      for (const track of tracks) {
        if (Array.isArray(conf[track])) {
          const trks = conf[track];
          for (let i = 0; i < trks.length; i++) {
            allTracks.push(VideoPlayer.buildTextTrackObj(track, trks[i]));
          }
        } else {
          allTracks.push(VideoPlayer.buildTextTrackObj(track, conf[track]));
        }
      }

      Utils.filterAndAddTextTracks(allTracks, this.videojs);
    }
  }

  _initSeekThumbs() {
    if (this.playerOptions.seekThumbnails) {

      this.videojs.on('cldsourcechanged', (e, { source }) => {
        // Bail if...

        if (source.getType() === 'AudioSource' || // it's an audio player
            (this.videojs && this.videojs.activePlugins_ && this.videojs.activePlugins_.vr) // It's a VR (i.e. 360) video
        ) {
          return;
        }

        const cloudinaryConfig = source.cloudinaryConfig();
        const publicId = source.publicId();

        const transformations = source.transformation().toOptions();

        if (transformations && transformations.streaming_profile) {
          delete transformations.streaming_profile;
        }

        transformations.flags = transformations.flags || [];
        transformations.flags.push('sprite');

        // build VTT url
        const vttSrc = cloudinaryConfig.video_url(publicId + '.vtt', { transformation: transformations });

        // vttThumbnails must be called differently on init and on source update.
        if (isFunction(this.videojs.vttThumbnails)) {
          this.videojs.vttThumbnails({ src: vttSrc });
        } else {
          this.videojs.vttThumbnails.src(vttSrc);
        }
      });
    }
  }

  _initColors () {
    this.videojs.colors(this.playerOptions.colors ? { 'colors': this.playerOptions.colors } : {});
  }

  // #if (!process.env.WEBPACK_BUILD_LIGHT)
  _initQualitySelector() {
    if (this._videojsOptions.controlBar && this.playerOptions.qualitySelector !== false) {
      if (videojs.browser.IE_VERSION === null) {
        this.videojs.httpSourceSelector({ default: 'auto' });
      }

      this.videojs.on('loadedmetadata', () => {
        qualitySelector.init(this.videojs);
      });

      // Show only if more then one option available
      this.videojs.on('loadeddata', () => {
        qualitySelector.setVisibility(this.videojs);
      });
    }
  }
  // #endif

  _initTextTracks () {
    this.videojs.on('refreshTextTracks', (e, tracks) => {
      this.setTextTracks(tracks);
    });
  }

  _initPerSrcBehaviors() {
    if (this.videojs.perSourceBehaviors) {
      this.videojs.perSourceBehaviors();
    }
  }

  _initJumpButtons() {
    if (!this.playerOptions.showJumpControls && this.videojs.controlBar) {
      this.videojs.controlBar.removeChild('JumpForwardButton');
      this.videojs.controlBar.removeChild('JumpBackButton');
    }
  }

  _initCloudinary() {
    const opts = this.playerOptions.cloudinary;
    opts.chainTarget = this;
    if (opts.secure !== false) {
      this.playerOptions.cloudinary.cloudinaryConfig.config('secure', true);
    }

    this.videojs.cloudinary(this.playerOptions.cloudinary);
  }

  _initAnalytics() {
    const analyticsOpts = this.playerOptions.analytics;

    if (analyticsOpts) {
      const opts = typeof analyticsOpts === 'object' ? analyticsOpts : {};
      this.videojs.analytics(opts);
    }
  }

  reTryVideo(maxNumberOfCalls, timeout) {
    if (!this.isVideoReady()) {
      if (this.nbCalls < maxNumberOfCalls) {
        this.nbCalls++;
        this.reTryId = this.videojs.setTimeout(this.reTryVideo, timeout);
      } else {
        let e = new Error('Video is not ready please try later');
        this.videojs.trigger('error', e);
      }
    }
  }

  isVideoReady() {
    const s = this.videojs.readyState();
    if (s >= (/iPad|iPhone|iPod/.test(navigator.userAgent) ? 1 : 4)) {
      this.nbCalls = 0;
      return true;
    }

    return false;
  }

  _initPlaylistWidget () {
    this.videojs.on('playlistcreated', () => {

      if (this._playlistWidget) {
        this._playlistWidget.dispose();
      }
      const plwOptions = this.playerOptions.playlistWidget;

      if (isPlainObject(plwOptions)) {
        if (this.playerOptions.fluid) {
          plwOptions.fluid = true;
        }
        if (this.playerOptions.cloudinary.fontFace) {
          plwOptions.fontFace = this.playerOptions.cloudinary.fontFace;
        }
        this._playlistWidget = new PlaylistWidget(this.videojs, plwOptions);
      }
    });
  }

  playlistWidget(options) {
    if (!options && !this._playlistWidget) {
      return false;
    }

    if (!options && this._playlistWidget) {
      return this._playlistWidget;
    }

    if (isPlainObject(options)) {
      this._playlistWidget.options(options);
    }

    return this._playlistWidget;
  }

  _initAutoplay() {
    const autoplayMode = this.playerOptions.autoplayMode;

    if (autoplayMode === 'on-scroll') {
      this.videojs.autoplayOnScroll();
    }
  }

  _initContextMenu() {
    if (!this.playerOptions.hideContextMenu) {
      this.videojs.contextMenu(defaults.contextMenu);
    }
  }

  _initFloatingPlayer() {
    if (this.playerOptions.floatingWhenNotVisible) {
      this.videojs.floatingPlayer({ 'floatTo': this.playerOptions.floatingWhenNotVisible });
    }
  }

  _setCssClasses() {
    this.videojs.addClass(Utils.CLASS_PREFIX);
    this.videojs.addClass(Utils.playerClassPrefix(this.videojs));

    Utils.setSkinClassPrefix(this.videojs, Utils.skinClassPrefix(this.videojs));

    if (videojs.browser.IE_VERSION === 11) {
      this.videojs.addClass('cld-ie11');
    }
  }

  _onReady() {
    this._setExtendedEvents();

    // Load first video (mainly to support video tag 'source' and 'public-id' attributes)
    const source = this.playerOptions.source || this.playerOptions.publicId;

    if (source) {
      this.source(source, this.playerOptions);
    }
  }

  _setExtendedEvents() {
    const events = [];
    if (this.playerOptions.playedEventPercents) {
      events.push({
        type: 'percentsplayed',
        percents: this.playerOptions.playedEventPercents
      });
    }

    if (this.playerOptions.playedEventTimes) {
      events.push({
        type: 'timeplayed',
        times: this.playerOptions.playedEventTimes
      });
    }

    events.push(...['seek', 'mute', 'unmute', 'qualitychanged']);

    const extendedEvents = new ExtendedEvents(this.videojs, { events });

    Object.keys(extendedEvents.events).forEach((_event) => {
      const handler = (event, data) => {
        this.videojs.trigger({ type: _event, eventData: data });
      };
      extendedEvents.on(_event, handler);
    });
  }

  cloudinaryConfig(config) {
    return this.videojs.cloudinary.cloudinaryConfig(config);
  }

  get playerOptions() {
    return this.options.playerOptions;
  }

  _setGoBackButton() {
    const button = createElement('div', { 'class': 'go-back-button' });

    button.addEventListener('click', () => {
      this.unZoom();
    }, false);

    const tracksContainer = createElement('div', { 'class': INTERACTION_AREAS_CONTAINER_CLASS_NAME }, button);
    setInteractionAreasContainer(this.videojs, tracksContainer);
  }

  addInteractionAreas(interactionAreas, interactionAreasOptions) {
    this._setStaticInteractionAreas = () => {
      this._addInteractionAreasItems(interactionAreas, interactionAreasOptions);
      this._setInteractionAreasContainerSize();
    };
  }

  getInteractionAreasConfig() {
    const { cldSrc } = this.videojs.currentSource();
    return cldSrc && cldSrc.getInteractionAreas();
  }

  _onZoom(src, newOption, item) {
    const currentSource = this.videojs.currentSource();
    const { cldSrc } = currentSource;
    const currentSrcOptions = cldSrc.getInitOptions();
    const option = newOption || { transformation: currentSrcOptions.transformation.toOptions() };
    const transformation = !src && getZoomTransformation(this.videoElement, item);
    const sourceOptions = transformation ? videojs.mergeOptions({ transformation }, option) : option;

    const newSource = cldSrc.isRawUrl ? currentSource.src : { publicId: cldSrc.publicId() };
    this.source(transformation ? { publicId: cldSrc.publicId() } : src, sourceOptions).play();

    this._isZoomed = true;

    this._setGoBackButton();

    this.unZoom = () => {
      if (this._isZoomed) {
        this._isZoomed = false;
        this._setStaticInteractionAreas && this._setStaticInteractionAreas();
        this.source(newSource, currentSrcOptions).play();
      }
    };
  }

  _onInteractionAreasClick(interactionAreasOptions, { event, item, index }) {
    interactionAreasOptions.onClick && interactionAreasOptions.onClick({
      item,
      index,
      event,
      zoom: (source, option) => {
        this._onZoom(source, option, item);
      }
    });
  }

  _addInteractionAreasItems(interactionAreasData, interactionAreasOptions = {}, previousInteractionAreasData) {
    if (previousInteractionAreasData) {
      updateInteractionAreasItem(this.videojs, this.playerOptions, interactionAreasData, previousInteractionAreasData, ({ event, item, index }) => {
        this._onInteractionAreasClick(interactionAreasOptions, { event, item, index });
      });
    } else {
      const interactionAreasItems = interactionAreasData.map((item, index) => {
        return getInteractionAreaItem(this.playerOptions, item, index, (event) => {
          this._onInteractionAreasClick(interactionAreasOptions, { event, item, index });
        });
      });

      setInteractionAreasContainer(this.videojs, createElement('div', { 'class': INTERACTION_AREAS_CONTAINER_CLASS_NAME }, interactionAreasItems));
    }
  }

  addCueListener(interactionAreasConfig, track) {
    if (!track) {
      return;
    }

    let previousTracksData = null;

    track.addEventListener('cuechange', () => {
      const activeCue = track.activeCues && track.activeCues[0];

      if (activeCue) {
        const tracksData = JSON.parse(activeCue.text);

        this._addInteractionAreasItems(tracksData, interactionAreasConfig, previousTracksData);
        !previousTracksData && this._setInteractionAreasContainerSize();
        previousTracksData = tracksData;
      } else {
        removeInteractionAreasContainer(this.videojs);
        previousTracksData = null;
      }
    });
  }

  currentPublicId() {
    return this.videojs.cloudinary.currentPublicId();
  }

  currentSourceUrl() {
    return this.videojs.currentSource().src;
  }

  currentPoster() {
    return this.videojs.cloudinary.currentPoster();
  }

  source(publicId, options = {}) {
    if (publicId instanceof VideoSource) {
      return this.videojs.cloudinary.source(publicId, options);
    }

    // Interactive plugin - available in full (not light) build only
    if (this.videojs.interactive) {
      this.videojs.interactive(this.videojs, options);
    }

    if (VideoPlayer.allowUsageReport()) {
      options.usageReport = true;
    }

    this.setTextTracks(options.textTracks);
    // #if (!process.env.WEBPACK_BUILD_LIGHT)
    this._initQualitySelector();
    // #endif
    clearTimeout(this.reTryId);
    this.nbCalls = 0;
    const maxTries = this.videojs.options_.maxTries || 3;
    const videoReadyTimeout = this.videojs.options_.videoTimeout || 55000;
    this.reTryVideo(maxTries, videoReadyTimeout);
    return this.videojs.cloudinary.source(publicId, options);
  }

  posterOptions(options) {
    return this.videojs.cloudinary.posterOptions(options);
  }

  skin(name) {
    if (name !== undefined && isString(name)) {
      Utils.setSkinClassPrefix(this.videojs, name);

      const playlistWidget = this.playlistWidget();

      if (this.playlistWidget()) {
        playlistWidget.setSkin();
      }
    }

    return Utils.skinClassPrefix(this.videojs);
  }

  playlist(sources, options = {}) {
    return this.videojs.cloudinary.playlist(sources, options);
  }

  playlistByTag(tag, options = {}) {
    return this.videojs.cloudinary.playlistByTag(tag, options);
  }

  sourcesByTag(tag, options = {}) {
    return this.videojs.cloudinary.sourcesByTag(tag, options);
  }

  fluid(bool) {
    if (bool === undefined) {
      return this.videojs.fluid();
    }

    if (bool) {
      this.videojs.addClass(FLUID_CLASS_NAME);
    } else {
      this.videojs.removeClass(FLUID_CLASS_NAME);
    }

    this.videojs.fluid(bool);
    this.videojs.trigger('fluid', bool);
    return this;
  }

  play() {
    this.playWasCalled = true;
    this.videojs.play();
    return this;
  }

  stop() {
    this.pause();
    this.currentTime(0);
    return this;
  }

  playPrevious() {
    this.playlist().playPrevious();
    return this;
  }

  playNext() {
    this.playlist().playNext();
    return this;
  }

  transformation(trans) {
    return this.videojs.cloudinary.transformation(trans);
  }

  sourceTypes(types) {
    return this.videojs.cloudinary.sourceTypes(types);
  }

  sourceTransformation(trans) {
    return this.videojs.cloudinary.sourceTransformation(trans);
  }

  autoShowRecommendations(autoShow) {
    return this.videojs.cloudinary.autoShowRecommendations(autoShow);
  }

  duration() {
    return this.videojs.duration();
  }

  height(dimension) {
    if (!dimension) {
      return this.videojs.height();
    }

    this.videojs.height(dimension);

    return this;
  }

  width(dimension) {
    if (!dimension) {
      return this.videojs.width();
    }

    this.videojs.width(dimension);

    return this;
  }

  volume(volume) {
    if (!volume) {
      return this.videojs.volume();
    }

    this.videojs.volume(volume);

    return this;
  }

  mute() {
    if (!this.isMuted()) {
      this.videojs.muted(true);
    }

    return this;
  }

  unmute() {
    if (this.isMuted()) {
      this.videojs.muted(false);
    }

    return this;
  }

  isMuted() {
    return this.videojs.muted();
  }

  pause() {
    this.videojs.pause();

    return this;
  }

  currentTime(offsetSeconds) {
    if (!offsetSeconds && offsetSeconds !== 0) {
      return this.videojs.currentTime();
    }

    this.videojs.currentTime(offsetSeconds);

    return this;
  }

  maximize() {
    if (!this.isMaximized()) {
      this.videojs.requestFullscreen();
    }

    return this;
  }

  exitMaximize() {
    if (this.isMaximized()) {
      this.videojs.exitFullscreen();
    }

    return this;
  }

  isMaximized() {
    return this.videojs.isFullscreen();
  }

  dispose() {
    this.videojs.dispose();
  }

  controls(bool) {
    if (bool === undefined) {
      return this.videojs.controls();
    }

    this.videojs.controls(bool);

    return this;
  }

  ima() {
    return {
      playAd: this.videojs.ima.playAd
    };
  }

  loop(bool) {
    if (bool === undefined) {
      return this.videojs.loop();
    }

    this.videojs.loop(bool);

    return this;
  }

  el() {
    return this.videojs.el();
  }
}

export default VideoPlayer;
