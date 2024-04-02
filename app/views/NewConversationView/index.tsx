import React from 'react';
import { FlatList, Keyboard, NativeEventSubscription, Text, View, StyleSheet } from 'react-native';
import sharedStyles from '../Styles';
import { connect } from 'react-redux';
import { dequal } from 'dequal';
import { Q } from '@nozbe/watermelondb';
import { withSafeAreaInsets } from 'react-native-safe-area-context';
import { Subscription } from 'rxjs';
import { StackNavigationOptions, StackNavigationProp } from '@react-navigation/stack';
import { Header } from '@react-navigation/elements';
import { CompositeNavigationProp, RouteProp } from '@react-navigation/native';
import { Dispatch } from 'redux';
import axios from 'axios';

import database from '../../lib/database';
import log, { logEvent, events } from '../../lib/methods/helpers/log';
import I18n from '../../i18n';
import { closeSearchHeader } from '../../actions/rooms';
import * as HeaderButton from '../../containers/HeaderButton';
import StatusBar from '../../containers/StatusBar';
import ActivityIndicator from '../../containers/ActivityIndicator';
import { animateNextTransition } from '../../lib/methods/helpers/layoutAnimation';
import { TSupportedThemes, withTheme } from '../../theme';
import { themedHeader } from '../../lib/methods/helpers/navigation';
import { getUserSelector } from '../../selectors/login';
import { goRoom } from '../../lib/methods/helpers/goRoom';
import SafeAreaView from '../../containers/SafeAreaView';
import { withDimensions } from '../../dimensions';
import { getInquiryQueueSelector } from '../../ee/omnichannel/selectors/inquiry';
import { IApplicationState, ISubscription, IUser, TSVStatus, SubscriptionType, TSubscriptionModel } from '../../definitions';
import styles from './styles';
import { HomeStackParamList, DrawerParamList } from '../../stacks/types';
import { RoomTypes, search } from '../../lib/methods';
import {
	hasPermission,
	debounce,
	compareServerVersion
} from '../../lib/methods/helpers';
import { SortBy, themes, STATUS_COLORS, colors } from '../../lib/constants';
import { Services } from '../../lib/services';
import { SupportedVersionsExpired } from '../../containers/SupportedVersions';
import { WebView } from 'react-native-webview';

type TNavigation = CompositeNavigationProp<
	StackNavigationProp<HomeStackParamList, 'NewConversationView'>,
	CompositeNavigationProp<StackNavigationProp<HomeStackParamList>, StackNavigationProp<DrawerParamList>>
>;

interface INewConversationViewProps {
	navigation: TNavigation;
	route: RouteProp<HomeStackParamList, 'NewConversationView'>;
	theme: TSupportedThemes;
	dispatch: Dispatch;
	[key: string]: IUser | string | boolean | ISubscription[] | number | object;
	user: IUser;
	server: string;
	searchText: string;
	changingServer: boolean;
	loadingServer: boolean;
	sortBy: string;
	groupByType: boolean;
	showFavorites: boolean;
	showUnread: boolean;
	refreshing: boolean;
	StoreLastMessage: boolean;
	useRealName: boolean;
	isMasterDetail: boolean;
	notificationPresenceCap: boolean;
	supportedVersionsStatus: TSVStatus;
	subscribedRoom: string;
	width: number;
	insets: {
		left: number;
		right: number;
	};
	queueSize: number;
	inquiryEnabled: boolean;
	showAvatar: boolean;
	displayMode: string;
	createTeamPermission: [];
	createDirectMessagePermission: [];
	createPublicChannelPermission: [];
	createPrivateChannelPermission: [];
	createDiscussionPermission: [];
	serverVersion: string;
	issuesWithNotifications: boolean;
}

interface INewConversationViewState {
	searching?: boolean;
	search?: IRoomItem[];
	gwToken?: string;
	gwError?: any;
	jsInjected?: boolean;
	loading?: boolean;
	chatsUpdate?: string[] | { rid: string; alert?: boolean }[];
	omnichannelsUpdate?: string[];
	chats?: IRoomItem[];
	item?: ISubscription;
	canCreateRoom?: boolean;
}

interface IRoomItem extends ISubscription {
	search?: boolean;
	outside?: boolean;
}

const CHATS_HEADER = 'Chats';
const UNREAD_HEADER = 'Unread';
const FAVORITES_HEADER = 'Favorites';
const DISCUSSIONS_HEADER = 'Discussions';
const TEAMS_HEADER = 'Teams';
const CHANNELS_HEADER = 'Channels';
const DM_HEADER = 'Direct_Messages';
const OMNICHANNEL_HEADER_IN_PROGRESS = 'Open_Livechats';
const OMNICHANNEL_HEADER_ON_HOLD = 'On_hold_Livechats';
const QUERY_SIZE = 20;

const filterIsUnread = (s: TSubscriptionModel) => (s.unread > 0 || s.tunread?.length > 0 || s.alert) && !s.hideUnreadStatus;
const filterIsFavorite = (s: TSubscriptionModel) => s.f;
const filterIsOmnichannel = (s: TSubscriptionModel) => s.t === 'l';
const filterIsTeam = (s: TSubscriptionModel) => s.teamMain;
const filterIsDiscussion = (s: TSubscriptionModel) => s.prid;

const shouldUpdateProps = [
	'searchText',
	'loadingServer',
	'useRealName',
	'StoreLastMessage',
	'theme',
	'isMasterDetail',
	'notificationPresenceCap',
	'refreshing',
	'queueSize',
	'inquiryEnabled',
	'createTeamPermission',
	'createDirectMessagePermission',
	'createPublicChannelPermission',
	'createPrivateChannelPermission',
	'createDiscussionPermission',
	'issuesWithNotifications',
	'supportedVersionsStatus'
];

const sortPreferencesShouldUpdate = ['sortBy', 'groupByType', 'showFavorites', 'showUnread'];

const displayPropsShouldUpdate = ['showAvatar', 'displayMode'];

// isSearching is needed to trigger RoomItem's useEffect properly after searching

class NewConversationView extends React.Component<INewConversationViewProps, INewConversationViewState> {
	private animated: boolean;
	private count: number;
	private backHandler?: NativeEventSubscription;
	private querySubscription?: Subscription;
	private scroll?: FlatList;
	private useRealName?: boolean;

	constructor(props: INewConversationViewProps) {
		super(props);
		console.time(`${this.constructor.name} init`);
		console.time(`${this.constructor.name} mount`);

		this.animated = false;
		this.count = 0;
		this.state = {
			searching: false,
			search: [],
			gwToken: undefined,
			gwError: undefined,
			jsInjected: false,
			loading: true,
			chatsUpdate: [] as TSubscriptionModel[],
			omnichannelsUpdate: [],
			chats: [],
			item: {} as ISubscription,
			canCreateRoom: false
		};
		this.setHeader();
		this.getSubscriptions();
	}

	componentDidMount() {
		this.handleHasPermission();
		console.timeEnd(`${this.constructor.name} mount`);
	}

	UNSAFE_componentWillReceiveProps(nextProps: INewConversationViewProps) {
		const { loadingServer, searchText, server, changingServer } = this.props;

		// when the server is changed
		if (server !== nextProps.server && loadingServer !== nextProps.loadingServer && nextProps.loadingServer) {
			this.setState({ loading: true });
		}
		// when the server is changing and stopped loading
		if (changingServer && loadingServer !== nextProps.loadingServer && !nextProps.loadingServer) {
			this.getSubscriptions();
		}
		if (searchText !== nextProps.searchText) {
			this.handleSearch(nextProps.searchText);
		}
	}

	shouldComponentUpdate(nextProps: INewConversationViewProps, nextState: INewConversationViewState) {
		const { chatsUpdate, searching, item, canCreateRoom, omnichannelsUpdate } = this.state;
		const propsUpdated = shouldUpdateProps.some(key => nextProps[key] !== this.props[key]);
		if (propsUpdated) {
			return true;
		}

		// check if some display props are changed to force update when focus this view again
		const displayUpdated = displayPropsShouldUpdate.some(key => nextProps[key] !== this.props[key]);
		if (displayUpdated) {
		}

		// check if some sort preferences are changed to getSubscription() when focus this view again
		const sortPreferencesUpdate = sortPreferencesShouldUpdate.some(key => nextProps[key] !== this.props[key]);
		if (sortPreferencesUpdate) {
		}

		// Compare changes only once

		// If they aren't equal, set to update if focused


		if (nextState.searching !== searching) {
			return true;
		}

		if (nextState.canCreateRoom !== canCreateRoom) {
			return true;
		}

		if (nextState.item?.rid !== item?.rid) {
			return true;
		}

		// Abort if it's not focused
		if (!nextProps.navigation.isFocused()) {
			return false;
		}

		const { loading, search, jsInjected, gwToken, gwError } = this.state;
		const { width, insets, subscribedRoom } = this.props;
		if (nextState.gwError !== gwError) {
			return true;
		}
		if (nextState.gwToken !== gwToken) {
			return true;
		}
		if (nextState.jsInjected !== jsInjected) {
			return true;
		}
		if (nextState.loading !== loading) {
			return true;
		}
		if (nextProps.width !== width) {
			return true;
		}
		if (!dequal(nextState.search, search)) {
			return true;
		}
		if (nextProps.subscribedRoom !== subscribedRoom) {
			return true;
		}
		if (!dequal(nextProps.insets, insets)) {
			return true;
		}

		return false;
	}

	componentDidUpdate(prevProps: INewConversationViewProps) {
		const {
			sortBy,
			groupByType,
			showFavorites,
			showUnread,
			subscribedRoom,
			isMasterDetail,
			notificationPresenceCap,
			insets,
			createTeamPermission,
			createPublicChannelPermission,
			createPrivateChannelPermission,
			createDirectMessagePermission,
			createDiscussionPermission,
			showAvatar,
			displayMode,
			issuesWithNotifications,
			supportedVersionsStatus
		} = this.props;
		const { item } = this.state;

		if (
			!(
				prevProps.sortBy === sortBy &&
				prevProps.groupByType === groupByType &&
				prevProps.showFavorites === showFavorites &&
				prevProps.showUnread === showUnread &&
				prevProps.showAvatar === showAvatar &&
				prevProps.displayMode === displayMode
			)
		) {
			this.getSubscriptions();
		}
		// Update current item in case of another action triggers an update on room subscribed reducer
		if (isMasterDetail && item?.rid !== subscribedRoom && subscribedRoom !== prevProps.subscribedRoom) {
			this.setState({ item: { rid: subscribedRoom } as ISubscription });
		}
		if (
			insets.left !== prevProps.insets.left ||
			insets.right !== prevProps.insets.right ||
			notificationPresenceCap !== prevProps.notificationPresenceCap ||
			issuesWithNotifications !== prevProps.issuesWithNotifications ||
			supportedVersionsStatus !== prevProps.supportedVersionsStatus
		) {
			this.setHeader();
		}

		if (
			!dequal(createTeamPermission, prevProps.createTeamPermission) ||
			!dequal(createPublicChannelPermission, prevProps.createPublicChannelPermission) ||
			!dequal(createPrivateChannelPermission, prevProps.createPrivateChannelPermission) ||
			!dequal(createDirectMessagePermission, prevProps.createDirectMessagePermission) ||
			!dequal(createDiscussionPermission, prevProps.createDiscussionPermission)
		) {
			this.handleHasPermission();
			this.setHeader();
		}
	}

	componentWillUnmount() {
		this.unsubscribeQuery();
		if (this.backHandler && this.backHandler.remove) {
			this.backHandler.remove();
		}
		console.countReset(`${this.constructor.name}.render calls`);
	}

	handleHasPermission = async () => {
		const {
			createTeamPermission,
			createDirectMessagePermission,
			createPublicChannelPermission,
			createPrivateChannelPermission,
			createDiscussionPermission
		} = this.props;
		const permissions = [
			createPublicChannelPermission,
			createPrivateChannelPermission,
			createTeamPermission,
			createDirectMessagePermission,
			createDiscussionPermission
		];
		const permissionsToCreate = await hasPermission(permissions);
		const canCreateRoom = permissionsToCreate.filter((r: boolean) => r === true).length > 0;
		this.setState({ canCreateRoom }, () => this.setHeader());
	};

	getHeader = (): StackNavigationOptions => {
		const { searching, canCreateRoom } = this.state;
		const { navigation, isMasterDetail, notificationPresenceCap, issuesWithNotifications, supportedVersionsStatus, theme } =
			this.props;

		const styles = StyleSheet.create({
			container: {
				flex: 1,
				justifyContent: 'center'
			},
			button: {
				flexDirection: 'row',
				alignItems: 'center'
			},
			title: {
				flexShrink: 1,
				fontSize: 16,
				...sharedStyles.textSemibold
			},
			subtitle: {
				fontSize: 14,
				...sharedStyles.textRegular
			},
			upsideDown: {
				transform: [{ scaleY: -1 }]
			}
		});

		if (searching) {
			return {
				headerTitleAlign: 'left',
				headerTitleContainerStyle: { flex: 1, marginHorizontal: 0, marginRight: 15, maxWidth: undefined },
				headerRightContainerStyle: { flexGrow: 0 },
				headerLeft: () => (
					<HeaderButton.Container left>
						<HeaderButton.Item iconName='close' onPress={this.cancelSearch} />
					</HeaderButton.Container>
				),
				headerTitle: () => (
					<View style={styles.container}>
						<Text style={[styles.title, { color: colors[theme].headerTitleColor }]} numberOfLines={1}>
							{I18n.t('New_conversation')}
						</Text>
					</View>
				),
				headerRight: () => null
			};
		}

		const getBadge = () => {
			if (supportedVersionsStatus === 'warn') {
				return <HeaderButton.BadgeWarn color={colors[theme].dangerColor} />;
			}
			if (notificationPresenceCap) {
				return <HeaderButton.BadgeWarn color={STATUS_COLORS.disabled} />;
			}
			return null;
		};

		return {
			headerTitleAlign: 'left',
			headerTitleContainerStyle: { flex: 1, marginHorizontal: 4, maxWidth: undefined },
			headerRightContainerStyle: { flexGrow: undefined, flexBasis: undefined },
			headerLeft: () => (
				<HeaderButton.Drawer
					navigation={navigation}
					testID='rooms-list-view-sidebar'
					onPress={
						isMasterDetail
							? () => navigation.navigate('ModalStackNavigator', { screen: 'SettingsView' })
							: // @ts-ignore
							  () => navigation.toggleDrawer()
					}
					badge={() => getBadge()}
					disabled={supportedVersionsStatus === 'expired'}
				/>
			),
			headerTitle: () => (
				<View style={styles.container}>
					<Text style={[styles.title, { color: colors[theme].headerTitleColor }]} numberOfLines={1}>
						{I18n.t('New_conversation')}
					</Text>
				</View>
			),
			headerRight: () => (
				<HeaderButton.Container>
					{issuesWithNotifications ? (
						<HeaderButton.Item
							iconName='notification-disabled'
							onPress={this.navigateToPushTroubleshootView}
							testID='rooms-list-view-push-troubleshoot'
							color={themes[theme].fontDanger}
						/>
					) : null}
				</HeaderButton.Container>
			)
		};
	};

	setHeader = () => {
		const { navigation } = this.props;
		const options = this.getHeader();
		navigation.setOptions(options);
	};

	internalSetState = (
		state:
			| ((
					prevState: Readonly<INewConversationViewState>,
					props: Readonly<INewConversationViewProps>
			  ) => Pick<INewConversationViewState, keyof INewConversationViewState> | INewConversationViewState | null)
			| (Pick<INewConversationViewState, keyof INewConversationViewState> | INewConversationViewState | null),
		callback?: () => void
	) => {
		if (this.animated) {
			animateNextTransition();
		}
		this.setState(state, callback);
	};

	addRoomsGroup = (data: TSubscriptionModel[], header: string, allData: TSubscriptionModel[]) => {
		if (data.length > 0) {
			if (header) {
				allData.push({ rid: header, separator: true } as TSubscriptionModel);
			}
			allData = allData.concat(data);
		}
		return allData;
	};

	getSubscriptions = async () => {
		this.unsubscribeQuery();

		const { sortBy, showUnread, showFavorites, groupByType, user } = this.props;

		const db = database.active;
		let observable;

		const defaultWhereClause = [Q.where('archived', false), Q.where('open', true)] as (Q.WhereDescription | Q.SortBy)[];

		if (sortBy === SortBy.Alphabetical) {
			defaultWhereClause.push(Q.experimentalSortBy(`${this.useRealName ? 'fname' : 'name'}`, Q.asc));
		} else {
			defaultWhereClause.push(Q.experimentalSortBy('room_updated_at', Q.desc));
		}

		// When we're grouping by something
		if (this.isGrouping) {
			observable = await db
				.get('subscriptions')
				.query(...defaultWhereClause)
				.observeWithColumns(['alert', 'on_hold', 'f']);
			// When we're NOT grouping
		} else {
			this.count += QUERY_SIZE;
			observable = await db
				.get('subscriptions')
				.query(...defaultWhereClause, Q.experimentalSkip(0), Q.experimentalTake(this.count))
				.observeWithColumns(['on_hold']);
		}

		this.querySubscription = observable.subscribe(data => {
			let tempChats = [] as TSubscriptionModel[];
			let chats = data;

			let omnichannelsUpdate: string[] = [];
			const isOmnichannelAgent = user?.roles?.includes('livechat-agent');
			if (isOmnichannelAgent) {
				const omnichannel = chats.filter(s => filterIsOmnichannel(s));
				const omnichannelInProgress = omnichannel.filter(s => !s.onHold);
				const omnichannelOnHold = omnichannel.filter(s => s.onHold);
				chats = chats.filter(s => !filterIsOmnichannel(s));
				omnichannelsUpdate = omnichannelInProgress.map(s => s.rid);
				tempChats = this.addRoomsGroup(omnichannelInProgress, OMNICHANNEL_HEADER_IN_PROGRESS, tempChats);
				tempChats = this.addRoomsGroup(omnichannelOnHold, OMNICHANNEL_HEADER_ON_HOLD, tempChats);
			}

			// unread
			if (showUnread) {
				const unread = chats.filter(s => filterIsUnread(s));
				chats = chats.filter(s => !filterIsUnread(s));
				tempChats = this.addRoomsGroup(unread, UNREAD_HEADER, tempChats);
			}

			// favorites
			if (showFavorites) {
				const favorites = chats.filter(s => filterIsFavorite(s));
				chats = chats.filter(s => !filterIsFavorite(s));
				tempChats = this.addRoomsGroup(favorites, FAVORITES_HEADER, tempChats);
			}

			// type
			if (groupByType) {
				const teams = chats.filter(s => filterIsTeam(s));
				const discussions = chats.filter(s => filterIsDiscussion(s));
				const channels = chats.filter(s => (s.t === 'c' || s.t === 'p') && !filterIsDiscussion(s) && !filterIsTeam(s));
				const direct = chats.filter(s => s.t === 'd' && !filterIsDiscussion(s) && !filterIsTeam(s));
				tempChats = this.addRoomsGroup(teams, TEAMS_HEADER, tempChats);
				tempChats = this.addRoomsGroup(discussions, DISCUSSIONS_HEADER, tempChats);
				tempChats = this.addRoomsGroup(channels, CHANNELS_HEADER, tempChats);
				tempChats = this.addRoomsGroup(direct, DM_HEADER, tempChats);
			} else if (showUnread || showFavorites || isOmnichannelAgent) {
				tempChats = this.addRoomsGroup(chats, CHATS_HEADER, tempChats);
			} else {
				tempChats = chats;
			}

			const chatsUpdate = tempChats.map(item => item.rid);

			this.internalSetState({
				chats: tempChats,
				chatsUpdate,
				omnichannelsUpdate,
				loading: false,
				jsInjected: false,
				gwToken: undefined,
				gwError: undefined
			});
		});
	};

	unsubscribeQuery = () => {
		if (this.querySubscription && this.querySubscription.unsubscribe) {
			this.querySubscription.unsubscribe();
		}
	};

	cancelSearch = () => {
		const { searching } = this.state;
		const { dispatch } = this.props;

		if (!searching) {
			return;
		}

		Keyboard.dismiss();

		this.setState({ searching: false, search: [] }, () => {
			this.setHeader();
			dispatch(closeSearchHeader());
			setTimeout(() => {
				this.scrollToTop();
			}, 200);
		});
	};

	handleBackPress = () => {
		return false;
	};

	// eslint-disable-next-line react/sort-comp
	handleSearch = debounce(async (text: string) => {
		const result = await search({ text });

		// if the search was cancelled before the promise is resolved
		const { searching } = this.state;
		if (!searching) {
			return;
		}
		this.internalSetState({
			search: result as IRoomItem[],
			searching: true
		});
		this.scrollToTop();
	}, 300);

	isSwipeEnabled = (item: IRoomItem) => !(item?.search || item?.joinCodeRequired || item?.outside);

	get isGrouping() {
		const { showUnread, showFavorites, groupByType } = this.props;
		return showUnread || showFavorites || groupByType;
	}

	scrollToTop = () => {
		if (this.scroll?.scrollToOffset) {
			this.scroll.scrollToOffset({ offset: 0 });
		}
	};

	toggleFav = async (rid: string, favorite: boolean): Promise<void> => {
		logEvent(favorite ? events.RL_UNFAVORITE_CHANNEL : events.RL_FAVORITE_CHANNEL);
		try {
			const db = database.active;
			const result = await Services.toggleFavorite(rid, !favorite);
			if (result.success) {
				const subCollection = db.get('subscriptions');
				await db.write(async () => {
					try {
						const subRecord = await subCollection.find(rid);
						await subRecord.update(sub => {
							sub.f = !favorite;
						});
					} catch (e) {
						log(e);
					}
				});
			}
		} catch (e) {
			logEvent(events.RL_TOGGLE_FAVORITE_F);
			log(e);
		}
	};

	toggleRead = async (rid: string, tIsRead: boolean) => {
		logEvent(tIsRead ? events.RL_UNREAD_CHANNEL : events.RL_READ_CHANNEL);
		const { serverVersion } = this.props;
		try {
			const db = database.active;
			const includeThreads = compareServerVersion(serverVersion, 'greaterThanOrEqualTo', '5.4.0');
			const result = await Services.toggleReadStatus(tIsRead, rid, includeThreads);

			if (result.success) {
				const subCollection = db.get('subscriptions');
				await db.write(async () => {
					try {
						const subRecord = await subCollection.find(rid);
						await subRecord.update(sub => {
							sub.alert = tIsRead;
							sub.unread = 0;
							if (includeThreads) {
								sub.tunread = [];
							}
						});
					} catch (e) {
						log(e);
					}
				});
			}
		} catch (e) {
			logEvent(events.RL_TOGGLE_READ_F);
			log(e);
		}
	};

	hideChannel = async (rid: string, type: SubscriptionType) => {
		logEvent(events.RL_HIDE_CHANNEL);
		try {
			const db = database.active;
			const result = await Services.hideRoom(rid, type as RoomTypes);
			if (result.success) {
				const subCollection = db.get('subscriptions');
				await db.write(async () => {
					try {
						const subRecord = await subCollection.find(rid);
						await subRecord.destroyPermanently();
					} catch (e) {
						log(e);
					}
				});
			}
		} catch (e) {
			logEvent(events.RL_HIDE_CHANNEL_F);
			log(e);
		}
	};

	goDirectory = () => {
		logEvent(events.RL_GO_DIRECTORY);
		const { navigation, isMasterDetail } = this.props;
		if (isMasterDetail) {
			navigation.navigate('ModalStackNavigator', { screen: 'DirectoryView' });
		} else {
			navigation.navigate('DirectoryView');
		}
	};

	navigateToPushTroubleshootView = () => {
		const { navigation, isMasterDetail } = this.props;
		if (isMasterDetail) {
			navigation.navigate('ModalStackNavigator', { screen: 'PushTroubleshootView' });
		} else {
			navigation.navigate('PushTroubleshootView');
		}
	};

	goQueue = () => {
		logEvent(events.RL_GO_QUEUE);
		const { navigation, isMasterDetail, inquiryEnabled } = this.props;

		if (!inquiryEnabled) {
			return;
		}

		if (isMasterDetail) {
			navigation.navigate('ModalStackNavigator', { screen: 'QueueListView' });
		} else {
			navigation.navigate('QueueListView');
		}
	};

	goRoom = ({ item, isMasterDetail }: { item: ISubscription; isMasterDetail: boolean }) => {
		logEvent(events.RL_GO_ROOM);
		const { item: currentItem } = this.state;
		const { subscribedRoom } = this.props;

		if (currentItem?.rid === item.rid || subscribedRoom === item.rid) {
			return;
		}
		// Only mark room as focused when in master detail layout
		if (isMasterDetail) {
			this.setState({ item });
		}
		goRoom({ item, isMasterDetail });
	};

	goToNewMessage = () => {
		logEvent(events.RL_GO_NEW_MSG);
		const { navigation, isMasterDetail } = this.props;

		if (isMasterDetail) {
			navigation.navigate('ModalStackNavigator', { screen: 'NewMessageView' });
		} else {
			navigation.navigate('NewMessageStackNavigator');
		}
	};


	getScrollRef = (ref: FlatList) => (this.scroll = ref);

	renderHeader = () => {
		const { isMasterDetail, theme } = this.props;

		if (!isMasterDetail) {
			return null;
		}

		const options = this.getHeader();
		return <Header title='' {...themedHeader(theme)} {...options} />;
	};

	renderScroll = () => {
		const { loading, jsInjected, gwToken, gwError } = this.state;
		const { theme, supportedVersionsStatus, user, server } = this.props;

		const getToken = async () => {
			try {
				const response = await axios.get(`https://gw1.vtcall.com.br/application/mobile?url=${server}`);

				switch (response.status) {
					case 200:
						return this.setState({ gwToken: response.data.uuid });
					case 404: 
						throw new Error('URL não encontrada!');
					case 403:
						throw new Error('URL inválida!');
					default:
						throw new Error('Erro Desconhecido.');
				}
			} catch (err) {
				throw err;
			}
		};

		if(gwError) {
			return(
				<View style={{
					flex: 1,
					justifyContent: 'center',
					alignItems: 'center',
					padding: 10
				}}>
					<Text style={{
						fontWeight: 'bold',
						fontSize: 20,
						color: "red"
					}}>
						{gwError.message}
					</Text>
				</View>
			);
		}

		if(server && !gwToken) {
			getToken().catch(err => this.setState({ gwError: err }));
		}

		if (loading || !user || !server || !gwToken) {
			return <ActivityIndicator />;
		}

		if (supportedVersionsStatus === 'expired') {
			return <SupportedVersionsExpired />;
		}

		return (
			<View style={{
				flex: 5,
				justifyContent: 'center',
				padding: 10
			}}>
				<Text style={[styles.groupTitle, { color: themes[theme].controlText }]}></Text>
				<View style={{
					position: 'relative',
					flex: 4,
				}}>
					{!jsInjected && <ActivityIndicator />}
					<WebView
						source={{ uri: `https://gw1.ochannel.app/wpp/start/${gwToken}?u=${user.id}&t=${user.token}` }}
						style={[{ backgroundColor: themes[theme].backgroundColor, opacity: jsInjected ? 1 : 0 }]}
						injectedJavaScript={`
							var textElements = document.querySelectorAll('h4, span:not(#paymentText)');
							for (var i = 0; i < textElements.length; i++) {
								textElements[i].style.color = '${themes[theme].controlText}';
							}

							var linkElements = document.querySelectorAll('div.sc-cCcYRi');
							for (var i = 0; i < linkElements.length; i++) {
								linkElements[i].style.display = 'none';
							}

							setTimeout(function() {
								window.ReactNativeWebView.postMessage('jsInjected');
							}, 0);
						`}
						onMessage={(event) => {
							if (event.nativeEvent.data === 'jsInjected') {
								this.setState({ jsInjected: true });
							}
						}}
						javaScriptEnabled={true}
					/>
				</View>
			</View>
		);
	};

	render = () => {
		console.count(`${this.constructor.name}.render calls`);
		const { theme } = this.props;

		return (
			<SafeAreaView testID='rooms-list-view' style={{ backgroundColor: themes[theme].backgroundColor }}>
				<StatusBar />
				{this.renderHeader()}
				{this.renderScroll()}
				{/* TODO - this ts-ignore is here because the route props, on IBaseScreen*/}
				{/* @ts-ignore*/}
			</SafeAreaView>
		);
	};
}

const mapStateToProps = (state: IApplicationState) => ({
	user: getUserSelector(state),
	isMasterDetail: state.app.isMasterDetail,
	notificationPresenceCap: state.app.notificationPresenceCap,
	supportedVersionsStatus: state.supportedVersions.status,
	server: state.server.server,
	changingServer: state.server.changingServer,
	searchText: state.rooms.searchText,
	loadingServer: state.server.loading,
	refreshing: state.rooms.refreshing,
	sortBy: state.sortPreferences.sortBy,
	groupByType: state.sortPreferences.groupByType,
	showFavorites: state.sortPreferences.showFavorites,
	showUnread: state.sortPreferences.showUnread,
	useRealName: state.settings.UI_Use_Real_Name,
	StoreLastMessage: state.settings.Store_Last_Message,
	subscribedRoom: state.room.subscribedRoom,
	queueSize: getInquiryQueueSelector(state).length,
	inquiryEnabled: state.inquiry.enabled,
	showAvatar: state.sortPreferences.showAvatar,
	displayMode: state.sortPreferences.displayMode,
	createTeamPermission: state.permissions['create-team'],
	createDirectMessagePermission: state.permissions['create-d'],
	createPublicChannelPermission: state.permissions['create-c'],
	createPrivateChannelPermission: state.permissions['create-p'],
	createDiscussionPermission: state.permissions['start-discussion'],
	serverVersion: state.server.version,
	issuesWithNotifications: state.troubleshootingNotification.issuesWithNotifications
});

export default connect(mapStateToProps)(withDimensions(withTheme(withSafeAreaInsets(NewConversationView))));
