/**
 * ga.js - analytics adapter for google analytics
 * Customization: GumtreeAU has modified this file to change GA Event Labels to include additional information.
 */

var events = require('src/events');
var utils = require('src/utils');
var CONSTANTS = require('src/constants.json');
var adaptermanager = require('src/adaptermanager');

var BID_REQUESTED = CONSTANTS.EVENTS.BID_REQUESTED;
var BID_TIMEOUT = CONSTANTS.EVENTS.BID_TIMEOUT;
var BID_RESPONSE = CONSTANTS.EVENTS.BID_RESPONSE;
var BID_WON = CONSTANTS.EVENTS.BID_WON;

var _disableInteraction = { nonInteraction: true };
var _analyticsQueue = [];
var _gaGlobal = null;
var _enableCheck = true;
var _category = 'Prebid.js Bids';
var _eventCount = 0;
var _enableDistribution = false;
var _trackerSend = null;
var _sampled = true;
var _gtauPage = null;
var _gtauScreenSize = null;
var _gtauTimeout = null;

/**
 * This will enable sending data to google analytics. Only call once, or duplicate data will be sent!
 * @param  {object} provider use to set GA global (if renamed);
 * @param  {object} options use to configure adapter;
 * @return {[type]}    [description]
 */
exports.enableAnalytics = function ({ provider, options }) {
  _gaGlobal = provider || 'ga';
  _trackerSend = options && options.trackerName ? options.trackerName + '.send' : 'send';
  _sampled = typeof options === 'undefined' || typeof options.sampling === 'undefined' ||
             Math.random() < parseFloat(options.sampling);

  _gtauPage = options.page;
  _gtauScreenSize = options.screenSize;
  _gtauTimeout = options.timeout;

  if (options && typeof options.global !== 'undefined') {
    _gaGlobal = options.global;
  }
  if (options && typeof options.enableDistribution !== 'undefined') {
    _enableDistribution = options.enableDistribution;
  }

  var bid = null;

  if (_sampled) {
    // first send all events fired before enableAnalytics called

    var existingEvents = events.getEvents();

    utils._each(existingEvents, function (eventObj) {
      if (typeof eventObj !== 'object') {
        return;
      }
      var args = eventObj.args;

      if (eventObj.eventType === BID_REQUESTED) {
        bid = args;
        sendBidRequestToGa(bid);
      } else if (eventObj.eventType === BID_RESPONSE) {
        // bid is 2nd args
        bid = args;
        sendBidResponseToGa(bid);
      } else if (eventObj.eventType === BID_TIMEOUT) {
        const bidderArray = args;
        sendBidTimeouts(bidderArray);
      } else if (eventObj.eventType === BID_WON) {
        bid = args;
        sendBidWonToGa(bid);
      }
    });

    // Next register event listeners to send data immediately

    // bidRequests
    events.on(BID_REQUESTED, function (bidRequestObj) {
      sendBidRequestToGa(bidRequestObj);
    });

    // bidResponses
    events.on(BID_RESPONSE, function (bid) {
      sendBidResponseToGa(bid);
    });

    // bidTimeouts
    events.on(BID_TIMEOUT, function (bidderArray) {
      sendBidTimeouts(bidderArray);
    });

    // wins
    events.on(BID_WON, function (bid) {
      sendBidWonToGa(bid);
    });
  } else {
    utils.logMessage('Prebid.js google analytics disabled by sampling');
  }

  // finally set this function to return log message, prevents multiple adapter listeners
  this.enableAnalytics = function _enable() {
    return utils.logMessage(`Analytics adapter already enabled, unnecessary call to \`enableAnalytics\`.`);
  };
};

exports.getTrackerSend = function getTrackerSend() {
  return _trackerSend;
};

/**
 * Check if gaGlobal or window.ga is defined on page. If defined execute all the GA commands
 */
function checkAnalytics() {
  if (_enableCheck && typeof window[_gaGlobal] === 'function') {
    for (var i = 0; i < _analyticsQueue.length; i++) {
      _analyticsQueue[i].call();
    }

    // override push to execute the command immediately from now on
    _analyticsQueue.push = function (fn) {
      fn.call();
    };

    // turn check into NOOP
    _enableCheck = false;
  }

  utils.logMessage('event count sent to GA: ' + _eventCount);
}

function convertToCents(dollars) {
  if (dollars) {
    return Math.floor(dollars * 100);
  }

  return 0;
}

function getLoadTimeDistribution(time) {
  var distribution;
  if (time >= 0 && time < 200) {
    distribution = '0-200ms';
  } else if (time >= 200 && time < 300) {
    distribution = '0200-300ms';
  } else if (time >= 300 && time < 400) {
    distribution = '0300-400ms';
  } else if (time >= 400 && time < 500) {
    distribution = '0400-500ms';
  } else if (time >= 500 && time < 600) {
    distribution = '0500-600ms';
  } else if (time >= 600 && time < 800) {
    distribution = '0600-800ms';
  } else if (time >= 800 && time < 1000) {
    distribution = '0800-1000ms';
  } else if (time >= 1000 && time < 1200) {
    distribution = '1000-1200ms';
  } else if (time >= 1200 && time < 1500) {
    distribution = '1200-1500ms';
  } else if (time >= 1500 && time < 2000) {
    distribution = '1500-2000ms';
  } else if (time >= 2000) {
    distribution = '2000ms above';
  }

  return distribution;
}

function getCpmDistribution(cpm) {
  var distribution;
  if (cpm >= 0 && cpm < 0.5) {
    distribution = '$0-0.5';
  } else if (cpm >= 0.5 && cpm < 1) {
    distribution = '$0.5-1';
  } else if (cpm >= 1 && cpm < 1.5) {
    distribution = '$1-1.5';
  } else if (cpm >= 1.5 && cpm < 2) {
    distribution = '$1.5-2';
  } else if (cpm >= 2 && cpm < 2.5) {
    distribution = '$2-2.5';
  } else if (cpm >= 2.5 && cpm < 3) {
    distribution = '$2.5-3';
  } else if (cpm >= 3 && cpm < 4) {
    distribution = '$3-4';
  } else if (cpm >= 4 && cpm < 6) {
    distribution = '$4-6';
  } else if (cpm >= 6 && cpm < 8) {
    distribution = '$6-8';
  } else if (cpm >= 8) {
    distribution = '$8 above';
  }

  return distribution;
}

function sendBidRequestToGa(bid) {
  if (bid && bid.bidderCode) {
    _analyticsQueue.push(function () {
      _eventCount++;
      window[_gaGlobal](_trackerSend, 'event', _category, 'Requests', getEventLabelFromBidder(bid.bidderCode), 1, _disableInteraction);
    });
  }

  // check the queue
  checkAnalytics();
}

function sendBidResponseToGa(bid) {
  if (bid && bid.bidderCode) {
    _analyticsQueue.push(function () {
      var cpmCents = convertToCents(bid.cpm);
      var bidder = bid.bidderCode;
      if (typeof bid.timeToRespond !== 'undefined' && _enableDistribution) {
        _eventCount++;
        var dis = getLoadTimeDistribution(bid.timeToRespond);
        window[_gaGlobal](_trackerSend, 'event', 'Prebid.js Load Time Distribution', dis, getEventLabelFromBidder(bidder), 1, _disableInteraction);
      }

      if (bid.cpm > 0) {
        _eventCount = _eventCount + 2;
        var cpmDis = getCpmDistribution(bid.cpm);
        if (_enableDistribution) {
          _eventCount++;
          window[_gaGlobal](_trackerSend, 'event', 'Prebid.js CPM Distribution', cpmDis, getEventLabelFromBidder(bidder), 1, _disableInteraction);
        }

        window[_gaGlobal](_trackerSend, 'event', _category, 'Bids', getEventLabelFromBid(bid), cpmCents, _disableInteraction);
        window[_gaGlobal](_trackerSend, 'event', _category, 'Bid Load Time', getEventLabelFromBid(bid), bid.timeToRespond, _disableInteraction);
      }
    });
  }

  // check the queue
  checkAnalytics();
}

function sendBidTimeouts(timedOutBidders) {
  _analyticsQueue.push(function () {
    utils._each(timedOutBidders, function (bidderCode) {
      _eventCount++;
      window[_gaGlobal](_trackerSend, 'event', _category, 'Timeouts', getEventLabelFromBidder(bidderCode), _disableInteraction);
    });
  });

  checkAnalytics();
}

function sendBidWonToGa(bid) {
  var cpmCents = convertToCents(bid.cpm);
  _analyticsQueue.push(function () {
    _eventCount++;
    window[_gaGlobal](_trackerSend, 'event', _category, 'Wins', getEventLabelFromBid(bid), cpmCents, _disableInteraction);
  });

  checkAnalytics();
}

// Adds PageType and adUnit size in addition to bidderCode
function getEventLabelFromBid(bid) {
  return [
    `dfpPage: ${_gtauPage}`,
    `bidderCode: ${bid.bidderCode}`,
    `adUnitSize: ${bid.width}x${bid.height}`,
    `bidTimeout: ${_gtauTimeout}`,
    `deviceSize: ${_gtauScreenSize}`,
  ].join(', ');
}

// Adds PageType in addition to bidderCode
function getEventLabelFromBidder(bidderCode) {
  return [
    `dfpPage: ${_gtauPage}`,
    `bidderCode: ${bidderCode}`,
    `bidTimeout: ${_gtauTimeout}`,
    `deviceSize: ${_gtauScreenSize}`,
  ].join(', ');
}

adaptermanager.registerAnalyticsAdapter({
  adapter: exports,
  code: 'ga'
});
