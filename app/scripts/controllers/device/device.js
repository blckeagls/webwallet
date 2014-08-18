/*global angular*/

angular.module('webwalletApp')
  .controller('DeviceCtrl', function (
      trezorService, flash, storage,
      $modal, $scope, $location, $routeParams, $document) {

    'use strict';

    var STORAGE_FORGET_ON_DISCONNECT = 'trezorForgetOnDisconnect';

    $scope.device = trezorService.get($routeParams.deviceId);
    if (!$scope.device) {
      $location.path('/');
      return;
    }

    $scope.$on('device.pin', promptPin);
    $scope.$on('device.button', promptButton);
    $scope.$on('device.passphrase', promptPassphrase);
    $scope.$on('device.disconnect', handleDisconnect);

    /**
     * Handle device disconnect
     *
     * (1) Ask the user if he/she wants to forget the device.
     *
     * Read from the localStorage the setting which says whether the user wants
     * to forget devices whenever they are disconnected.
     * - If the setting says yes, then forget the device.
     * - If the setting says no, then don't do anything.
     * - If the setting isn't set at all, ask the user how would he/she like
     * the app to behave using a modal dialog.  User's answer is stored to
     * localStorage for all devices.
     *
     * (2) If the Forget modal is already shown, close it.
     *
     * @param {Object} event  Event object
     * @param {TrezorDevice} devId  ID of the device that was disconnected
     */
    function handleDisconnect(event, devId) {
      if (trezorService.isForgetInProgress()) {
        if ($scope.device.id === devId &&
            trezorService.getForgetModal()) {
          trezorService.getForgetModal().close();
          _forgetDevice($scope.device);
          trezorService.setForgetInProgress(false);
        }
        return;
      }
      var forgetOnDisconnect = storage[STORAGE_FORGET_ON_DISCONNECT];
      if (forgetOnDisconnect === undefined) {
        promptDisconnect()
          .then(function () {
            storage[STORAGE_FORGET_ON_DISCONNECT] = 'true';
            _forgetDevice(trezorService.get(devId));
          }, function () {
            storage[STORAGE_FORGET_ON_DISCONNECT] = 'false';
          });
      } else if (forgetOnDisconnect === 'true') {
        _forgetDevice(trezorService.get(devId));
      }
    }

    /**
     * Forget current device
     *
     * If the device is connected, ask the user to disconnect it before.
     */
    $scope.forgetDevice = function () {
      if (!$scope.device.isConnected()) {
        _forgetDevice($scope.device);
        return;
      }

      trezorService.setForgetInProgress(true);
      promptForget()
        .then(function () {
          _forgetDevice($scope.device);
          trezorService.setForgetInProgress(false);
        }, function () {
          trezorService.setForgetInProgress(false);
        });
    };

    /**
     * Forget device identified by passed Device object
     *
     * Unlike `$scope.forgetDevice()`, the user is not asked anything.
     *
     * @param {TrezorDevice} device  Device to forget
     */
    function _forgetDevice(device) {
      trezorService.forget(device);
      $location.path('/');
      return;
    }

    /**
     * Change device PIN
     *
     * Ask the user to set the PIN and then save the value.
     */
    $scope.changePin = function () {
      $scope.device.changePin().then(
        function () {
          flash.success('PIN was successfully changed');
        },
        function (err) {
          flash.error(err.message || 'PIN change failed');
        }
      );
    };

    /**
     * Change device label
     *
     * Ask the user to set the label.  If he/she fills in an empty value, the
     * default label is used.  The default label is read from
     * `TrezorDevice#getDefaultLabel()`.
     */
    $scope.changeLabel = function () {
      promptLabel()
        .then(function (label) {
          label = label.trim() || $scope.device.getDefaultLabel();
          return $scope.device.changeLabel(label);
        })
        .then(
          function () {
            flash.success('Label was successfully changed');
          },
          function (err) {
            // Closing the label modal triggers rejection without error.
            if (err) {
              flash.error(err.message || 'Failed to change the device label');
            }
          }
        );
    };

    /**
     * Prompt forget
     *
     * Ask the user to disconnect the device using a modal dialog.  If the user
     * then disconnects the device, the Promise -- which this function returns
     * -- is resolved, if the user closes the modal dialog or hits Cancel, the
     * Promise is failed.
     *
     * @return {Promise}
     */
    function promptForget() {
      var modal = $modal.open({
        templateUrl: 'views/modal/forget.html',
        size: 'sm',
        backdrop: 'static',
        keyboard: false
      });

      trezorService.setForgetModal(modal);

      modal.opened.then(function () {
        $scope.$emit('modal.forget.show');
      });
      modal.result.finally(function () {
        trezorService.setForgetModal(null);
        $scope.$emit('modal.forget.hide');
      });

      return modal.result;
    }

    /**
     * Prompt label
     *
     * Ask the user to set the device label using a modal dialog.
     */
    function promptLabel() {
      var scope, modal;

      scope = angular.extend($scope.$new(), {
        label: $scope.device.features.label || ''
      });

      modal = $modal.open({
        templateUrl: 'views/modal/label.html',
        size: 'sm',
        windowClass: 'labelmodal',
        backdrop: 'static',
        keyboard: false,
        scope: scope,
      });
      modal.opened.then(function () { scope.$emit('modal.label.show'); });
      modal.result.finally(function () { scope.$emit('modal.label.hide'); });

      return modal.result;
    }

    /**
     * Prompt PIN
     *
     * Ask the user to set the device PIN using a modal dialog.  Bind keypress
     * events that allow the user to control the number buttons (dial) using
     * a keyboard.
     *
     * @param {Event} event        Event object
     * @param {TrezorDevice} dev   Device
     * @param {String} type        Action type.  Possible values:
     *                                 - 'PinMatrixRequestType_Current'
     *                                 - 'PinMatrixRequestType_NewFirst'
     *                                 - 'PinMatrixRequestType_NewSecond'
     * @param {Function} callback  Called as `callback(err, res)`
     */
    function promptPin(event, dev, type, callback) {
      var scope, modal;

      if (dev.id !== $scope.device.id)
        return;

      scope = angular.extend($scope.$new(), {
        pin: '',
        type: type
      });

      scope.addPin = function (num) {
        scope.pin = scope.pin + num.toString();
      };

      scope.delPin = function () {
        scope.pin = scope.pin.slice(0, -1);
      };

      scope.isPinSet = function () {
        return scope.pin.length > 0;
      };

      modal = $modal.open({
        templateUrl: 'views/modal/pin.html',
        size: 'sm',
        windowClass: 'pinmodal',
        backdrop: 'static',
        keyboard: false,
        scope: scope
      });
      modal.opened.then(function () { scope.$emit('modal.pin.show', type); });
      modal.result.finally(function () { scope.$emit('modal.pin.hide'); });

      $document.on('keypress', _pinKeypressHandler);

      modal.result.then(
        function (res) {
          $document.off('keypress', _pinKeypressHandler);
          callback(null, res);
        },
        function (err) {
          $document.off('keypress', _pinKeypressHandler);
          callback(err);
        }
      );

      function _pinKeypressHandler(e) {
        if (e.which === 8) { // Backspace
          scope.delPin();
          scope.$digest();
          return false;
        } else if (e.which >= 48 && e.which <= 57) {
          scope.addPin(e.key);
          scope.$digest();
        }
      }
    }

    /**
     * Prompt disconnect
     *
     * Ask the user if he/she wants to forget or remember devices whenever they
     * are disconnected.  User's answer is stored to localStorage for all
     * devices.  The user is never asked again.
     *
     * Returns a Promise that is resolved if the user wants to forget the
     * device, and failed if the user wants to remember the device.
     *
     * @return {Promise}
     */
    function promptDisconnect() {
      var modal = $modal.open({
        templateUrl: 'views/modal/disconnect.html',
        backdrop: 'static',
        keyboard: false
      });
      modal.opened.then(function () {
        $scope.$emit('modal.disconnect.show');
      });
      modal.result.finally(function () {
        $scope.$emit('modal.disconnect.hide');
      });

      return modal.result;
    }

    function promptPassphrase(event, dev, callback) {
      var scope, modal;

      if (dev.id !== $scope.device.id)
        return;

      scope = angular.extend($scope.$new(), {
        check: !$scope.device.hasSavedPassphrase(),
        passphrase: '',
        passphraseCheck: '',
        installHandler: installSubmitHandlers
      });

      modal = $modal.open({
        templateUrl: 'views/modal/passphrase.html',
        size: 'sm',
        windowClass: 'passphrasemodal',
        backdrop: 'static',
        keyboard: false,
        scope: scope
      });
      modal.opened.then(function () { scope.$emit('modal.passphrase.show'); });
      modal.result.finally(function () { scope.$emit('modal.passphrase.hide'); });

      modal.result.then(
        function (res) {
          if (!$scope.device.checkPassphraseAndSave(res))
            callback(new Error('Invalid passphrase'));
          else
            callback(null, res);
        },
        function (err) { callback(err); }
      );

      function installSubmitHandlers() {
        var submit = document.getElementById('passphrase-submit');
        var form = document.getElementById('passphrase-form');

        submit.addEventListener('submit', submitModal, false);
        submit.addEventListener('click', submitModal, false);
        form.addEventListener('submit', submitModal, false);
        form.addEventListener('keypress', function (e) {
          if (e.keyCode === 13) submitModal();
        }, true);
      }

      function submitModal() {
        var ppScope = scope.$$childHead.$$childHead.$$nextSibling; // sad panda :(
        modal.close(ppScope.passphrase);
        return false;
      }
    }

    function promptButton(event, dev, code) {
      var scope, modal;

      if (dev.id !== $scope.device.id)
        return;

      scope = angular.extend($scope.$new(), {
        code: code
      });

      modal = $modal.open({
        templateUrl: 'views/modal/button.html',
        windowClass: 'buttonmodal',
        backdrop: 'static',
        keyboard: false,
        scope: scope
      });
      modal.opened.then(function () { scope.$emit('modal.button.show', code); });
      modal.result.finally(function () { scope.$emit('modal.button.hide'); });

      $scope.device.once('receive', function () { modal.close(); });
      $scope.device.once('error', function () { modal.close(); });
    }

  });
