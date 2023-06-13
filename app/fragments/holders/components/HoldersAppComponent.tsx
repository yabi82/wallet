import * as React from 'react';
import { ActivityIndicator, Linking, Text, Platform, View, BackHandler, Pressable, KeyboardAvoidingView } from 'react-native';
import WebView from 'react-native-webview';
import Animated, { Easing, FadeIn, FadeInDown, FadeOutDown, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { ShouldStartLoadRequest, WebViewMessageEvent, WebViewNavigation } from 'react-native-webview/lib/WebViewTypes';
import { extractDomain } from '../../../engine/utils/extractDomain';
import { useTypedNavigation } from '../../../utils/useTypedNavigation';
import { MixpanelEvent, trackEvent, useTrackEvent } from '../../../analytics/mixpanel';
import { resolveUrl } from '../../../utils/resolveUrl';
import { protectNavigation } from '../../apps/components/protect/protectNavigation';
import { useEngine } from '../../../engine/Engine';
import { contractFromPublicKey } from '../../../engine/contractFromPublicKey';
import { createInjectSource, dispatchMainButtonResponse, dispatchResponse } from '../../apps/components/inject/createInjectSource';
import { useInjectEngine } from '../../apps/components/inject/useInjectEngine';
import { warn } from '../../../utils/log';
import { HoldersAppParams } from '../HoldersAppFragment';
import { openWithInApp } from '../../../utils/openWithInApp';
import { extractHoldersQueryParams } from '../utils';
import { AndroidToolbar } from '../../../components/topbar/AndroidToolbar';
import { BackPolicy } from '../types';
import { getLocales } from 'react-native-localize';
import { t } from '../../../i18n/t';
import { useLinkNavigator } from '../../../useLinkNavigator';
import { useAppConfig } from '../../../utils/AppConfigContext';
import { OfflineWebView } from './OfflineWebView';
import * as FileSystem from 'expo-file-system';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { storage } from '../../../storage/storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DappMainButton, reduceMainButton, setParamsCodec } from '../../../components/DappMainButton';
import { AnotherKeyboardAvoidingView } from 'react-native-another-keyboard-avoiding-view';

export const HoldersAppComponent = React.memo((
    props: {
        variant: HoldersAppParams,
        token: string,
        title: string,
        endpoint: string
    }
) => {
    const { Theme, AppConfig } = useAppConfig();
    const engine = useEngine();
    const status = engine.products.holders.useStatus();
    const webRef = useRef<WebView>(null);
    const navigation = useTypedNavigation();
    const lang = getLocales()[0].languageCode;
    const currency = engine.products.price.usePrimaryCurrency();
    const offlineApp = engine.products.holders.useOfflineApp();

    const useMainButton = storage.getBoolean('dev-tools:use-main-button');

    const [mainButton, dispatchMainButton] = useReducer(
        reduceMainButton(),
        {
            text: '',
            textColor: Theme.item,
            color: Theme.accent,
            isVisible: false,
            isActive: false,
            isProgressVisible: false,
            onPress: undefined,
        }
    );
    const [backPolicy, setBackPolicy] = useState<BackPolicy>('back');
    const [hideKeyboardAccessoryView, setHideKeyboardAccessoryView] = useState(true);
    const [offlineAppReady, setOfflineAppReady] = useState(false);

    useEffect(() => {
        (async () => {
            if (!(storage.getBoolean('dev-tools:use-offline-app') ?? false)) {
                return false;
            }
            if (!offlineApp) {
                return false;
            }

            const filesCheck: Promise<boolean>[] = [];
            offlineApp.resources.forEach((asset) => {
                filesCheck.push((async () => {
                    const info = await FileSystem.getInfoAsync(`${FileSystem.documentDirectory}holders/${asset}`);
                    return info.exists;
                })());
            });

            filesCheck.push((async () => {
                const info = await FileSystem.getInfoAsync(`${FileSystem.documentDirectory}holders/index.html`);
                return info.exists;
            })());

            const files = await Promise.all(filesCheck);
            setOfflineAppReady(files.every((f) => f));
        })();
    }, [offlineApp]);

    const source = useMemo(() => {
        let route = '';
        if (props.variant.type === 'account') {
            route = status.state === 'ok' ? '/create' : '/';
        } else if (props.variant.type === 'card') {
            route = `/card/${props.variant.id}`;
        }

        return {
            url: `${props.endpoint}${route}?lang=${lang}&currency=${currency}`,
            initialRoute: `${route}?lang=${lang}&currency=${currency}`,
        };
    }, [props, lang, currency, status]);

    // 
    // Track events
    // 
    const start = useMemo(() => {
        return Date.now();
    }, []);
    useTrackEvent(MixpanelEvent.Holders, { url: props.variant.type }, AppConfig.isTestnet);

    //
    // View
    //
    let [loaded, setLoaded] = useState(false);
    const opacity = useSharedValue(1);
    const animatedStyles = useAnimatedStyle(() => {
        return {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: Theme.item,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: withTiming(opacity.value, { duration: 300, easing: Easing.bezier(0.42, 0, 1, 1) }),
        };
    });

    //
    // Navigation
    //
    const linkNavigator = useLinkNavigator(AppConfig.isTestnet);
    const loadWithRequest = useCallback((event: ShouldStartLoadRequest): boolean => {
        if (extractDomain(event.url) === extractDomain(props.endpoint)) {
            return true;
        }

        // Resolve internal url
        const resolved = resolveUrl(event.url, AppConfig.isTestnet);
        if (resolved) {
            linkNavigator(resolved);
            return false;
        }

        // Secondary protection
        let prt = protectNavigation(event.url, props.endpoint);
        if (prt) {
            return true;
        }

        // Resolve linking
        Linking.openURL(event.url);
        return false;
    }, []);

    //
    // Injection
    //
    const injectSource = useMemo(() => {
        const contract = contractFromPublicKey(engine.publicKey);
        const walletConfig = contract.source.backup();
        const walletType = contract.source.type;
        const domain = extractDomain(props.endpoint);

        const cardsState = engine.persistence.holdersCards.item(engine.address).value;
        const accountState = engine.persistence.holdersStatus.item(engine.address).value;

        const initialState = {
            ...accountState
                ? {
                    account: {
                        status: {
                            state: accountState.state,
                            kycStatus: accountState.state === 'need-kyc' ? accountState.kycStatus : null,
                        }
                    }
                }
                : {},
            ...cardsState ? { cardsList: cardsState.accounts } : {},
        }

        const initialInjection = `
        window.initialState = ${JSON.stringify(initialState)};
        `;

        let domainSign = engine.products.keys.createDomainSignature(domain);

        return createInjectSource(
            {
                version: 1,
                platform: Platform.OS,
                platformVersion: Platform.Version,
                network: AppConfig.isTestnet ? 'testnet' : 'mainnet',
                address: engine.address.toFriendly({ testOnly: AppConfig.isTestnet }),
                publicKey: engine.publicKey.toString('base64'),
                walletConfig,
                walletType,
                signature: domainSign.signature,
                time: domainSign.time,
                subkey: {
                    domain: domainSign.subkey.domain,
                    publicKey: domainSign.subkey.publicKey,
                    time: domainSign.subkey.time,
                    signature: domainSign.subkey.signature
                }
            },
            initialInjection,
            true
        );
    }, []);
    const injectionEngine = useInjectEngine(extractDomain(props.endpoint), props.title, AppConfig.isTestnet);
    const handleWebViewMessage = useCallback((event: WebViewMessageEvent) => {
        const nativeEvent = event.nativeEvent;

        // Resolve parameters
        let data: any;
        let id: number;
        try {
            let parsed = JSON.parse(nativeEvent.data);
            // Main button API
            if (typeof parsed.data.name === 'string' && (parsed.data.name as string).indexOf('main-button') !== -1) {
                const actionType = parsed.data.name.split('.')[1];

                if (actionType === 'onClick' && typeof parsed.id === 'number') {
                    id = parsed.id;
                    dispatchMainButton({
                        type: 'onClick',
                        args: { callback: () => dispatchMainButtonResponse(webRef, { id }) }
                    });
                    return;
                }
                switch (actionType) {
                    case 'show':
                        dispatchMainButton({ type: 'show' });
                        break;
                    case 'hide':
                        dispatchMainButton({ type: 'hide' });
                        break;
                    case 'enable':
                        dispatchMainButton({ type: 'enable' });
                        break;
                    case 'disable':
                        dispatchMainButton({ type: 'disable' });
                        break;
                    case 'showProgress':
                        dispatchMainButton({ type: 'showProgress' });
                        break;
                    case 'hideProgress':
                        dispatchMainButton({ type: 'hideProgress' });
                        break;
                    case 'setParams': {
                        if (setParamsCodec.is(parsed.data.args)) {
                            dispatchMainButton({ type: 'setParams', args: parsed.data.args });
                        }
                        warn('Invalid main button params');
                        break;
                    }
                    case 'offClick': {
                        dispatchMainButton({ type: 'offClick' });

                    }
                    default:
                        warn('Invalid main button action type');
                }
                return;
            }

            if (typeof parsed.id !== 'number') {
                warn('Invalid operation id');
                return;
            }
            id = parsed.id;
            data = parsed.data;
        } catch (e) {
            warn(e);
            return;
        }

        if (data.name === 'openUrl' && data.args.url) {
            try {
                let pageDomain = extractDomain(data.args.url);
                if (
                    pageDomain.endsWith('tonsandbox.com')
                    || pageDomain.endsWith('tonwhales.com')
                    || pageDomain.endsWith('tontestnet.com')
                    || pageDomain.endsWith('tonhub.com')
                ) {
                    openWithInApp(data.args.url);
                    return;
                }
            } catch (e) {
                console.warn(e);
            }
        }
        if (data.name === 'closeApp') {
            navigation.goBack();
            return;
        }

        // Execute
        (async () => {
            let res = { type: 'error', message: 'Unknown error' };
            try {
                res = await injectionEngine.execute(data);
            } catch (e) {
                warn(e);
            }
            dispatchResponse(webRef, { id, data: res });
        })();
    }, []);

    const onCloseApp = useCallback(() => {
        engine.products.holders.doSync();
        navigation.goBack();
        trackEvent(MixpanelEvent.HoldersClose, { type: props.variant.type, duration: Date.now() - start }, AppConfig.isTestnet);
    }, []);

    const safelyOpenUrl = useCallback((url: string) => {
        try {
            let pageDomain = extractDomain(url);
            if (
                pageDomain.endsWith('tonsandbox.com')
                || pageDomain.endsWith('tonwhales.com')
                || pageDomain.endsWith('tontestnet.com')
                || pageDomain.endsWith('tonhub.com')
            ) {
                openWithInApp(url);
                return;
            }
        } catch (e) {
            warn(e);
        }
    }, []);

    const onNavigation = useCallback((url: string) => {
        const params = extractHoldersQueryParams(url);
        if (params.closeApp) {
            onCloseApp();
            return;
        }
        setHideKeyboardAccessoryView(!params.showKeyboardAccessoryView);
        setBackPolicy(params.backPolicy);
        if (params.openUrl) {
            safelyOpenUrl(params.openUrl);
        }
    }, []);

    const onHardwareBackPress = useCallback(() => {
        if (backPolicy === 'lock') {
            return true;
        }
        if (backPolicy === 'back') {
            if (webRef.current) {
                webRef.current.goBack();
            }
            return true;
        }
        if (backPolicy === 'close') {
            navigation.goBack();
            return true;
        }
        return false;
    }, [backPolicy]);

    useEffect(() => {
        BackHandler.addEventListener('hardwareBackPress', onHardwareBackPress);
        return () => {
            BackHandler.removeEventListener('hardwareBackPress', onHardwareBackPress);
        }
    }, [onHardwareBackPress]);

    const onContentProcessDidTerminate = useCallback(() => {
        webRef.current?.reload();
    }, []);

    return (
        <>
            <View style={{ backgroundColor: Theme.item, flexGrow: 1, flexBasis: 0, alignSelf: 'stretch' }}>
                {useMainButton && (
                    <>
                        {offlineAppReady && (
                            <OfflineWebView
                                ref={webRef}
                                uri={`${FileSystem.documentDirectory}holders/index.html`}
                                initialRoute={source.initialRoute}
                                style={{
                                    backgroundColor: Theme.item,
                                    flexGrow: 1, flexBasis: 0, height: '100%',
                                    alignSelf: 'stretch',
                                    marginTop: Platform.OS === 'ios' ? 0 : 8,
                                }}
                                onLoadEnd={() => {
                                    setLoaded(true);
                                    opacity.value = 0;
                                }}
                                onLoadProgress={(event) => {
                                    if (Platform.OS === 'android' && event.nativeEvent.progress === 1) {
                                        // Searching for supported query
                                        onNavigation(event.nativeEvent.url);
                                    }
                                }}
                                onNavigationStateChange={(event: WebViewNavigation) => {
                                    // Searching for supported query
                                    onNavigation(event.url);
                                }}
                                // Locking scroll, it's handled within the Web App
                                scrollEnabled={false}
                                contentInset={{ top: 0, bottom: 0 }}
                                autoManageStatusBarEnabled={false}
                                decelerationRate="normal"
                                allowsInlineMediaPlayback={true}
                                injectedJavaScriptBeforeContentLoaded={injectSource}
                                onShouldStartLoadWithRequest={loadWithRequest}
                                // In case of iOS blank WebView
                                onContentProcessDidTerminate={onContentProcessDidTerminate}
                                // In case of Android blank WebView
                                onRenderProcessGone={onContentProcessDidTerminate}
                                onMessage={handleWebViewMessage}
                                keyboardDisplayRequiresUserAction={false}
                                hideKeyboardAccessoryView={hideKeyboardAccessoryView}
                                bounces={false}
                                startInLoadingState={true}
                            />
                        )}
                        {!offlineAppReady && (
                            <Animated.View style={{ flexGrow: 1, flexBasis: 0, height: '100%', }} entering={FadeIn}>
                                <WebView
                                    ref={webRef}
                                    // source={{ uri: source.url }}
                                    source={{ uri: `http://192.168.1.135:3000${source.initialRoute}` }}
                                    startInLoadingState={true}
                                    style={{
                                        backgroundColor: Theme.item,
                                        flexGrow: 1, flexBasis: 0, height: '100%',
                                        alignSelf: 'stretch',
                                        marginTop: Platform.OS === 'ios' ? 0 : 8,
                                    }}
                                    onLoadEnd={() => {
                                        setLoaded(true);
                                        opacity.value = 0;
                                    }}
                                    onLoadProgress={(event) => {
                                        if (Platform.OS === 'android' && event.nativeEvent.progress === 1) {
                                            // Searching for supported query
                                            onNavigation(event.nativeEvent.url);
                                        }
                                    }}
                                    onNavigationStateChange={(event: WebViewNavigation) => {
                                        // Searching for supported query
                                        onNavigation(event.url);
                                    }}
                                    // Locking scroll, it's handled within the Web App
                                    scrollEnabled={false}
                                    contentInset={{ top: 0, bottom: 0 }}
                                    autoManageStatusBarEnabled={false}
                                    allowFileAccessFromFileURLs={false}
                                    allowUniversalAccessFromFileURLs={false}
                                    decelerationRate="normal"
                                    allowsInlineMediaPlayback={true}
                                    injectedJavaScriptBeforeContentLoaded={injectSource}
                                    onShouldStartLoadWithRequest={loadWithRequest}
                                    // In case of iOS blank WebView
                                    onContentProcessDidTerminate={onContentProcessDidTerminate}
                                    // In case of Android blank WebView
                                    onRenderProcessGone={onContentProcessDidTerminate}
                                    onMessage={handleWebViewMessage}
                                    keyboardDisplayRequiresUserAction={false}
                                    hideKeyboardAccessoryView={hideKeyboardAccessoryView}
                                    bounces={false}
                                />
                            </Animated.View>
                        )}
                    </>
                )}
                {!useMainButton && (
                    <AnotherKeyboardAvoidingView
                        style={{ backgroundColor: Theme.item, flexGrow: 1 }}
                    >
                            {offlineAppReady && (
                                <OfflineWebView
                                    ref={webRef}
                                    uri={`${FileSystem.documentDirectory}holders/index.html`}
                                    initialRoute={source.initialRoute}
                                    style={{
                                        backgroundColor: Theme.item,
                                        flexGrow: 1, flexBasis: 0, height: '100%',
                                        alignSelf: 'stretch',
                                        marginTop: Platform.OS === 'ios' ? 0 : 8,
                                    }}
                                    onLoadEnd={() => {
                                        setLoaded(true);
                                        opacity.value = 0;
                                    }}
                                    onLoadProgress={(event) => {
                                        if (Platform.OS === 'android' && event.nativeEvent.progress === 1) {
                                            // Searching for supported query
                                            onNavigation(event.nativeEvent.url);
                                        }
                                    }}
                                    onNavigationStateChange={(event: WebViewNavigation) => {
                                        // Searching for supported query
                                        onNavigation(event.url);
                                    }}
                                    // Locking scroll, it's handled within the Web App
                                    scrollEnabled={false}
                                    contentInset={{ top: 0, bottom: 0 }}
                                    autoManageStatusBarEnabled={false}
                                    decelerationRate="normal"
                                    allowsInlineMediaPlayback={true}
                                    injectedJavaScriptBeforeContentLoaded={injectSource}
                                    onShouldStartLoadWithRequest={loadWithRequest}
                                    // In case of iOS blank WebView
                                    onContentProcessDidTerminate={onContentProcessDidTerminate}
                                    // In case of Android blank WebView
                                    onRenderProcessGone={onContentProcessDidTerminate}
                                    onMessage={handleWebViewMessage}
                                    keyboardDisplayRequiresUserAction={false}
                                    hideKeyboardAccessoryView={hideKeyboardAccessoryView}
                                    bounces={false}
                                    startInLoadingState={true}
                                />
                            )}
                            {!offlineAppReady && (
                                <Animated.View style={{ flexGrow: 1, flexBasis: 0, height: '100%', }} entering={FadeIn}>
                                    <WebView
                                        ref={webRef}
                                        source={{ uri: source.url }}
                                        startInLoadingState={true}
                                        style={{
                                            backgroundColor: Theme.item,
                                            flexGrow: 1, flexBasis: 0, height: '100%',
                                            alignSelf: 'stretch',
                                            marginTop: Platform.OS === 'ios' ? 0 : 8,
                                        }}
                                        onLoadEnd={() => {
                                            setLoaded(true);
                                            opacity.value = 0;
                                        }}
                                        onLoadProgress={(event) => {
                                            if (Platform.OS === 'android' && event.nativeEvent.progress === 1) {
                                                // Searching for supported query
                                                onNavigation(event.nativeEvent.url);
                                            }
                                        }}
                                        onNavigationStateChange={(event: WebViewNavigation) => {
                                            // Searching for supported query
                                            onNavigation(event.url);
                                        }}
                                        // Locking scroll, it's handled within the Web App
                                        scrollEnabled={false}
                                        contentInset={{ top: 0, bottom: 0 }}
                                        autoManageStatusBarEnabled={false}
                                        allowFileAccessFromFileURLs={false}
                                        allowUniversalAccessFromFileURLs={false}
                                        decelerationRate="normal"
                                        allowsInlineMediaPlayback={true}
                                        injectedJavaScriptBeforeContentLoaded={injectSource}
                                        onShouldStartLoadWithRequest={loadWithRequest}
                                        // In case of iOS blank WebView
                                        onContentProcessDidTerminate={onContentProcessDidTerminate}
                                        // In case of Android blank WebView
                                        onRenderProcessGone={onContentProcessDidTerminate}
                                        onMessage={handleWebViewMessage}
                                        keyboardDisplayRequiresUserAction={false}
                                        hideKeyboardAccessoryView={hideKeyboardAccessoryView}
                                        bounces={false}
                                    />
                                </Animated.View>
                            )}
                    </AnotherKeyboardAvoidingView>
                )}
                {offlineAppReady && (
                    <Animated.View
                        style={animatedStyles}
                        pointerEvents={loaded ? 'none' : 'box-none'}
                    >
                        <View style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
                            <AndroidToolbar accentColor={'#564CE2'} onBack={() => navigation.goBack()} />
                        </View>
                        {Platform.OS === 'ios' && (
                            <Pressable
                                style={{ position: 'absolute', top: 22, right: 16 }}
                                onPress={() => {
                                    navigation.goBack();
                                }} >
                                <Text style={{ color: '#564CE2', fontWeight: '500', fontSize: 17 }}>
                                    {t('common.close')}
                                </Text>
                            </Pressable>
                        )}
                    </Animated.View>
                )}
                {!offlineAppReady && (
                    <Animated.View
                        style={animatedStyles}
                        pointerEvents={loaded ? 'none' : 'box-none'}
                    >
                        <View style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
                            <AndroidToolbar accentColor={'#564CE2'} onBack={() => navigation.goBack()} />
                        </View>
                        {Platform.OS === 'ios' && (
                            <Pressable
                                style={{ position: 'absolute', top: 22, right: 16 }}
                                onPress={() => {
                                    navigation.goBack();
                                }} >
                                <Text style={{ color: '#564CE2', fontWeight: '500', fontSize: 17 }}>
                                    {t('common.close')}
                                </Text>
                            </Pressable>
                        )}
                        <ActivityIndicator size="small" color={'#564CE2'} />
                    </Animated.View>
                )}
                {mainButton && useMainButton && (
                    <KeyboardAvoidingView
                        behavior={Platform.OS === 'ios' ? 'position' : undefined}
                        contentContainerStyle={{ marginHorizontal: 16 }}
                        keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 16}
                    >
                        {mainButton.isVisible && (
                            <Animated.View entering={FadeInDown} exiting={FadeOutDown}>
                                <DappMainButton
                                    isActive={!mainButton.isActive}
                                    text={mainButton.text}
                                    color={mainButton.color}
                                    textColor={mainButton.textColor}
                                    isProgressVisible={mainButton.isProgressVisible}
                                    onPress={mainButton.onPress}
                                />
                            </Animated.View>
                        )}
                    </KeyboardAvoidingView>
                )}
            </View>
        </>
    );
});