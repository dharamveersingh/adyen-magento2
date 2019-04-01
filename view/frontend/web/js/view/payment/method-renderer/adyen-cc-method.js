/**
 *                       ######
 *                       ######
 * ############    ####( ######  #####. ######  ############   ############
 * #############  #####( ######  #####. ######  #############  #############
 *        ######  #####( ######  #####. ######  #####  ######  #####  ######
 * ###### ######  #####( ######  #####. ######  #####  #####   #####  ######
 * ###### ######  #####( ######  #####. ######  #####          #####  ######
 * #############  #############  #############  #############  #####  ######
 *  ############   ############  #############   ############  #####  ######
 *                                      ######
 *                               #############
 *                               ############
 *
 * Adyen Payment module (https://www.adyen.com/)
 *
 * Copyright (c) 2015 Adyen BV (https://www.adyen.com/)
 * See LICENSE.txt for license details.
 *
 * Author: Adyen <magento@adyen.com>
 */
define(
    [
        'jquery',
        'ko',
        'Magento_Payment/js/view/payment/cc-form',
        'Magento_Customer/js/model/customer',
        'Magento_Payment/js/model/credit-card-validation/credit-card-data',
        'Magento_Checkout/js/model/payment/additional-validators',
        'Magento_Checkout/js/model/quote',
        'Adyen_Payment/js/model/installments',
        'mage/url',
        'Magento_Vault/js/view/payment/vault-enabler',
        'Magento_Checkout/js/model/url-builder',
        'mage/storage',
        'Magento_Checkout/js/model/full-screen-loader',
        'Magento_Paypal/js/action/set-payment-method',
        'Magento_Checkout/js/action/select-payment-method',
        'Adyen_Payment/js/threeds2-js-utils'
    ],
    function ($, ko, Component, customer, creditCardData, additionalValidators, quote, installments, url, VaultEnabler, urlBuilder, storage, fullScreenLoader, setPaymentMethodAction, selectPaymentMethodAction, threeDS2Utils) {

        'use strict';

        return Component.extend({
            // need to duplicate as without the button will never activate on first time page view
            isPlaceOrderActionAllowed: ko.observable(quote.billingAddress() != null),

            defaults: {
                template: 'Adyen_Payment/payment/cc-form',
                creditCardOwner: '',
                storeCc: false,
                installment: '',
                creditCardDetailsValid: false
            },
            /**
             * @returns {exports.initialize}
             */
            initialize: function () {
                this._super();
                this.vaultEnabler = new VaultEnabler();
                this.vaultEnabler.setPaymentCode(this.getVaultCode());
                this.vaultEnabler.isActivePaymentTokenEnabler(false);

                // initialize adyen component for general use
                this.checkout = new AdyenCheckout({
                    locale: this.getLocale()
                });

                return this;
            },
            initObservable: function () {
                this._super()
                    .observe([
                        'creditCardType',
                        'creditCardOwner',
                        'creditCardNumber',
                        'securityCode',
                        'expiryMonth',
                        'expiryYear',
                        'installment',
                        'creditCardDetailsValid',
                        'variant',
                        'placeOrderAllowed'
                    ]);

                return this;
            },
            getInstallments: installments.getInstallments(),
            /**
             * Renders the secure fields,
             * creates the card component,
             * sets up the callbacks for card components and
             * set up the installments
             */
            renderSecureFields: function () {
                var self = this;

                if (!self.getOriginKey()) {
                    return;
                }

                installments.setInstallments(0);

                // installments enabled ??
                var allInstallments = self.getAllInstallments();
                var cardNode = document.getElementById('cardContainer');

                var enableStoreDetails = false;
                if (self.canCreateBillingAgreement() && !self.isVaultEnabled())  {
                    enableStoreDetails = true;
                }

                self.cardComponent = self.checkout.create('card', {
                    originKey: self.getOriginKey(),
                    loadingContext: self.getLoadingContext(),
                    type: 'card',
                    hasHolderName: true,
                    holderNameRequired: true,
                    enableStoreDetails: enableStoreDetails,
                    groupTypes: self.getAvailableCardTypeAltCodes(),

                    onChange: function (state, component) {
                        if (!!state.isValid && !component.state.errors.encryptedSecurityCode) {
                            self.storeCc = !!state.data.storeDetails;
                            self.variant(state.brand);
                            self.creditCardNumber(state.data.encryptedCardNumber);
                            self.expiryMonth(state.data.encryptedExpiryMonth);
                            self.expiryYear(state.data.encryptedExpiryYear);
                            self.securityCode(state.data.encryptedSecurityCode);
                            self.creditCardOwner(state.data.holderName);
                            self.creditCardDetailsValid(true);
                            self.placeOrderAllowed(true);
                        } else {
                            self.creditCardDetailsValid(false);
                            self.placeOrderAllowed(false);
                        }
                    },
                    onBrand: function (state) {
                        // Define the card type
                        // translate adyen card type to magento card type
                        var creditCardType = self.getCcCodeByAltCode(state.brand);
                        if (creditCardType) {
                            // If the credit card type is already set, check if it changed or not
                            if (!self.creditCardType() || self.creditCardType() && self.creditCardType() != creditCardType) {
                                if (creditCardType in allInstallments) {

                                    // get for the creditcard the installments
                                    var installmentCreditcard = allInstallments[creditCardType];
                                    var grandTotal = quote.totals().grand_total;

                                    var numberOfInstallments = [];
                                    var dividedAmount = 0;
                                    var dividedString = "";
                                    $.each(installmentCreditcard, function (amount, installment) {

                                        if (grandTotal >= amount) {
                                            dividedAmount = (grandTotal / installment).toFixed(quote.getPriceFormat().precision);
                                            dividedString = installment + " x " + dividedAmount + " " + quote.totals().quote_currency_code;
                                            numberOfInstallments.push({
                                                key: [dividedString],
                                                value: installment
                                            });
                                        }
                                        else {
                                            return false;
                                        }
                                    });
                                }
                                if (numberOfInstallments) {
                                    installments.setInstallments(numberOfInstallments);
                                }
                                else {
                                    installments.setInstallments(0);
                                }
                            }

                            // for BCMC as this is not a core payment method inside magento use maestro as brand detection
                            if (creditCardType == "BCMC") {
                                self.creditCardType("MI");
                            } else {
                                self.creditCardType(creditCardType);

                            }
                        } else {
                            self.creditCardType("")
                            installments.setInstallments(0);
                        }
                    }
                }).mount(cardNode);
            },
            /**
             * Rendering the 3DS2.0 components
             * To do the device fingerprint at the response of IdentifyShopper render the threeDS2DeviceFingerprint
             * component
             * To render the challenge for the customer at the response of ChallengeShopper render the
             * threeDS2Challenge component
             * Both of them is going to be rendered in a Magento dialog popup
             *
             * @param type
             * @param token
             */
            renderThreeDS2Component: function(type, token) {
                var self = this;

                var threeDS2Node = document.getElementById('threeDS2Container');
                
                if (type == "IdentifyShopper") {
                    fullScreenLoader.startLoader();
                    self.threeDS2Component = self.checkout
                        .create('threeDS2DeviceFingerprint', {
                            fingerprintToken: token,
                            onComplete: function(result) {
                                fullScreenLoader.stopLoader();
                                self.processThreeDS2(result.data);
                            }
                        });
                } else if (type == "ChallengeShopper") {
                    $('#threeDS2Modal').modal({
                        // disable user to hide popup
                        clickableOverlay: false,
                        // empty buttons, we don't need that
                        buttons: []
                    });

                    $('#threeDS2Modal').modal("openModal");

                    self.threeDS2Component = self.checkout
                        .create('threeDS2Challenge', {
                            challengeToken: token,
                            onComplete: function(result) {
                                self.processThreeDS2(result.data);
                                $('#threeDS2Modal').modal("closeModal");
                            }
                        });
                }

                self.threeDS2Component.mount(threeDS2Node);
            },
            /**
             * The results that the 3DS2 components returns in the onComplete callback needs to be sent to the
             * backend to the /adyen/threeDS2Process endpoint and based on the response render a new threeDS2
             * component or place the order (validateThreeDS2OrPlaceOrder)
             * @param response
             */
            processThreeDS2: function(data) {
                var self = this;

                fullScreenLoader.startLoader();

                var payload = {
                    "payload": JSON.stringify(data)
                };

                var serviceUrl = urlBuilder.createUrl('/adyen/threeDS2Process', {});

                storage.post(
                    serviceUrl,
                    JSON.stringify(payload),
                    true
                ).done(function(responseJSON) {
                    fullScreenLoader.stopLoader();
                    self.validateThreeDS2OrPlaceOrder(responseJSON)
                }).error(function(responseJSON) {
                    fullScreenLoader.stopLoader();
                });
            },
            /**
             * Builds the payment details part of the payment information reqeust
             *
             * @returns {{method: *, additional_data: {card_brand: *, cc_type: *, number: *, cvc: *, expiryMonth: *, expiryYear: *, holderName: *, store_cc: (boolean|*), number_of_installments: *, java_enabled: boolean, screen_color_depth: number, screen_width, screen_height, timezone_offset: *}}}
             */
            getCcData: function () {
                var browserInfo = threeDS2Utils.getBrowserInfo();

                var data = {
                    'method': this.item.method,
                    additional_data: {
                        'card_brand': this.variant(),
                        'cc_type': this.creditCardType(),
                        'number': this.creditCardNumber(),
                        'cvc': this.securityCode(),
                        'expiryMonth': this.expiryMonth(),
                        'expiryYear': this.expiryYear(),
                        'holderName': this.creditCardOwner(),
                        'store_cc': this.storeCc,
                        'number_of_installments': this.installment(),
                        'java_enabled': browserInfo.javaEnabled,
                        'screen_color_depth': browserInfo.colorDepth,
                        'screen_width': browserInfo.screenWidth,
                        'screen_height': browserInfo.screenHeight,
                        'timezone_offset': browserInfo.timeZoneOffset
                    }
                };
                this.vaultEnabler.visitAdditionalData(data);
                return data;
            },
            /**
             * Get data for place order
             * @returns {{method: *}}
             */
            getData: function() {
                var data = {
                    'method': this.item.method
                };
                return data;
            },
            /**
             * Returns state of place order button
             * @returns {boolean}
             */
            isButtonActive: function () {
                return this.isActive() && this.getCode() == this.isChecked() && this.isPlaceOrderActionAllowed() && this.placeOrderAllowed();
            },
            /**
             * Custom place order function
             *
             * @override
             *
             * @param data
             * @param event
             * @returns {boolean}
             */
            placeOrder: function (data, event) {
                var self = this;

                if (event) {
                    event.preventDefault();
                }

                if (this.validate() && additionalValidators.validate()) {
                    fullScreenLoader.startLoader();
                    self.isPlaceOrderActionAllowed(false);

                    //update payment method information if additional data was changed
                    selectPaymentMethodAction(this.getCcData());
                    setPaymentMethodAction(this.messageContainer).done(
                        function (responseJSON) {
                            fullScreenLoader.stopLoader();
                            self.isPlaceOrderActionAllowed(true);
                            self.validateThreeDS2OrPlaceOrder(responseJSON);
                        }).error(function() {
                            fullScreenLoader.stopLoader();
                            self.isPlaceOrderActionAllowed(true);
                    });

                    return false;
                }

                return false;
            },
            /**
             * Based on the response we can start a 3DS2 validation or place the order
             * @param responseJSON
             */
            validateThreeDS2OrPlaceOrder: function(responseJSON) {
                var self = this;

                var response = JSON.parse(responseJSON);

                if (!!response.threeDS2) {
                    // render component
                    self.renderThreeDS2Component(response.type, response.token);
                } else {
                    self.getPlaceOrderDeferredObject()
                        .fail(
                            function () {
                                self.isPlaceOrderActionAllowed(true);
                            }
                        ).done(
                        function () {
                            self.afterPlaceOrder();

                            if (self.redirectAfterPlaceOrder) {
                                // use custom redirect Link for supporting 3D secure
                                window.location.replace(url.build(window.checkoutConfig.payment[quote.paymentMethod().method].redirectUrl));
                            }
                        }
                    );
                }
            },
            /**
             * Validates the payment date when clicking the pay button
             *
             * @returns {boolean}
             */
            validate: function () {
                var self = this;

                var form = 'form[data-role=adyen-cc-form]';

                var validate = $(form).validation() && $(form).validation('isValid');

                if (!validate) {
                    return false;
                }

                return true;
            },
            /**
             * Validates if the typed in card holder is valid
             * - length validation, can not be empty
             *
             * @returns {boolean}
             */
            isCardOwnerValid: function () {
                if (this.creditCardOwner().length == 0) {
                    return false;
                }

                return true;
            },
            /**
             * The card component send the card details validity in a callback which is saved in the
             * creditCardDetailsValid observable
             *
             * @returns {*}
             */
            isCreditCardDetailsValid: function () {
                return this.creditCardDetailsValid();
            },
            /**
             * Translates the card type alt code (used in Adyen) to card type code (used in Magento) if it's available
             *
             * @param altCode
             * @returns {*}
             */
            getCcCodeByAltCode: function (altCode) {
                var ccTypes = window.checkoutConfig.payment.ccform.availableTypesByAlt[this.getCode()];
                if (ccTypes.hasOwnProperty(altCode)) {
                    return ccTypes[altCode];
                }

                return "";
            },
            /**
             * Get available card types translated to the Adyen card type codes
             * (The card type alt code is the Adyen card type code)
             *
             * @returns {string[]}
             */
            getAvailableCardTypeAltCodes: function () {
                var ccTypes = window.checkoutConfig.payment.ccform.availableTypesByAlt[this.getCode()];
                return Object.keys(ccTypes);
            },
            /**
             * Return Payment method code
             *
             * @returns {*}
             */
            getCode: function () {
                return window.checkoutConfig.payment.adyenCc.methodCode;
            },
            getOriginKey: function () {
                return window.checkoutConfig.payment.adyenCc.originKey;
            },
            getLoadingContext: function () {
                return window.checkoutConfig.payment.adyenCc.checkoutUrl;
            },
            getLocale: function () {
                return window.checkoutConfig.payment.adyenCc.locale;
            },
            isActive: function () {
                return true;
            },
            getControllerName: function () {
                return window.checkoutConfig.payment.iframe.controllerName[this.getCode()];
            },
            getPlaceOrderUrl: function () {
                return window.checkoutConfig.payment.iframe.placeOrderUrl[this.getCode()];
            },
            canCreateBillingAgreement: function () {
                if (customer.isLoggedIn()) {
                    return window.checkoutConfig.payment.adyenCc.canCreateBillingAgreement;
                }

                return false;
            },
            isShowLegend: function () {
                return true;
            },
            showLogo: function () {
                return window.checkoutConfig.payment.adyen.showLogo;
            },
            getIcons: function (type) {
                return window.checkoutConfig.payment.adyenCc.icons.hasOwnProperty(type)
                    ? window.checkoutConfig.payment.adyenCc.icons[type]
                    : false
            },
            hasInstallments: function () {
                return window.checkoutConfig.payment.adyenCc.hasInstallments;
            },
            getAllInstallments: function () {
                return window.checkoutConfig.payment.adyenCc.installments;
            },
            setPlaceOrderHandler: function (handler) {
                this.placeOrderHandler = handler;
            },
            setValidateHandler: function (handler) {
                this.validateHandler = handler;
            },
            context: function () {
                return this;
            },
            /**
             * @returns {Bool}
             */
            isVaultEnabled: function () {
                return this.vaultEnabler.isVaultEnabled();
            },
            /**
             * @returns {String}
             */
            getVaultCode: function () {
                return window.checkoutConfig.payment[this.getCode()].vaultCode;
            }
        });
    }
);
