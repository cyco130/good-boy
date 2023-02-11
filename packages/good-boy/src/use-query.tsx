import React, {
	createContext,
	ReactNode,
	useContext,
	useEffect,
	useMemo,
	useSyncExternalStore,
} from "react";

/**
 * Fetches data
 *
 * @template T      Type of data
 * @param key       Query key. Queries with the same key are considered identical. Pass undefined to disable the query.
 * @param fn        Query function that does the actual data fetching
 * @param [options] Query options
 * @returns query   Query result
 */
export function useQuery<T>(
	key: undefined,
	fn: QueryFn<T>,
	options?: UseQueryOptions,
): undefined;

export function useQuery<T>(
	key: string,
	fn: QueryFn<T>,
	options?: UseQueryOptions,
): QueryResult<T>;

export function useQuery<T>(
	key: string | undefined,
	fn: QueryFn<T>,
	options?: UseQueryOptions,
): QueryResult<T> | undefined;

export function useQuery<T>(
	key: string | undefined,
	fn: QueryFn<T>,
	options: UseQueryOptions = {},
): QueryResult<T> | undefined {
	const fullOptions = { ...DEFAULT_QUERY_OPTIONS, ...options };
	const result = useQueryBase(key, fn, fullOptions);
	useRefetch(result, fullOptions);

	return result;
}

/** Function passed to useQuery */
export type QueryFn<T> = (ctx: QueryFunctionContext) => Awaitable<T>;

export type Awaitable<T> = T | Promise<T>;

/** useQuery options */
export interface UseQueryOptions {
	/**
	 * Time in milliseconds after which the value will be evicted from the
	 * cache when there are no subscribers. Use 0 for immediate eviction and
	 * `Infinity` to disable.
	 *
	 * @default 300_000 (5 minutes)
	 */
	cacheTime?: number;
	/**
	 * Time in milliseconds after which a cached value will be considered
	 * stale.
	 *
	 * @default 100
	 */
	staleTime?: number;
	/**
	 * Refetch the query when the component is mounted. If set to `true`, a stale
	 * query will be refetched when the component is mounted. If set to `"always"`,
	 * the query will be refetched when the component is mounted regardless of
	 * staleness. `false` disables this behavior.
	 *
	 * @default true
	 */
	refetchOnMount?: boolean | "always";
	/**
	 * Refetch the query when the window gains focus. If set to `true`, the
	 * query will be refetched on window focus if it is stale. If set to
	 * `"always"`, the query will be refetched on window focus regardless of
	 * staleness. `false` disables this behavior.
	 *
	 * @default false
	 */
	refetchOnWindowFocus?: boolean | "always";
	/**
	 * Continuously refetch every `refetchInterval` milliseconds. Set to false
	 * to disable.
	 *
	 * @default false
	 */
	refetchInterval?: number | false;
	/**
	 * Perform continuous refetching even when the window is in the background.
	 *
	 * @default false
	 */
	refetchIntervalInBackground?: boolean;
	/**
	 * Refetch the query when the internet connection is restored. If set to
	 * `true`, a stale query will be refetched when the internet connection is
	 * restored. If set to `"always"`, the query will be refetched when the
	 * internet connection is restored regardless of staleness. `false` disables
	 * this behavior.
	 *
	 * @default false
	 */
	refetchOnReconnect?: boolean | "always";
}

/** Return value of useQuery */
export interface QueryResult<T> {
	/** Fetched data */
	data: T;
	/** Refetch the data */
	refetch(): void;
	/** Is the data being refetched? */
	isRefetching: boolean;
	/** Update date of the last returned data */
	dataUpdatedAt?: number;
}

export const DEFAULT_QUERY_OPTIONS: Required<UseQueryOptions> = {
	cacheTime: 5 * 60 * 1000,
	staleTime: 100,
	refetchOnMount: false,
	refetchOnWindowFocus: false,
	refetchInterval: false,
	refetchIntervalInBackground: false,
	refetchOnReconnect: false,
};

function useQueryBase<T>(
	key: string | undefined,
	fn: QueryFn<T>,
	options: Required<UseQueryOptions>,
): QueryResult<T> | undefined {
	const { cacheTime, staleTime, refetchOnMount } = options;

	const cache = useContext(QueryCacheContext);

	if (!cache) {
		throw new Error("No query cache found");
	}

	const item = useSyncExternalStore(
		(onStoreChange) => {
			if (key !== undefined) {
				return cache.subscribe(key, () => {
					onStoreChange();
				});
			} else {
				return () => {
					// Do nothing
				};
			}
		},
		() => (key === undefined ? undefined : cache.get(key)),
		() => (key === undefined ? undefined : cache.get(key)),
	);

	const ctx: QueryFunctionContext = { queryKey: key! };

	useEffect(() => {
		const cacheItem = key ? cache.get(key) : undefined;

		if (cacheItem === undefined) {
			return;
		}

		if (
			(cacheItem.invalid ||
				(refetchOnMount &&
					(refetchOnMount === "always" ||
						!cacheItem.date ||
						staleTime <= Date.now() - cacheItem.date))) &&
			!cacheItem.promise &&
			!cacheItem.hydrated
		) {
			const promiseOrValue = fn(ctx);
			cache.set(key!, promiseOrValue, cacheTime);
		}

		cacheItem.hydrated = false;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [key, item?.invalid]);

	// preserve reference between calls
	const queryResultReference = useMemo(() => ({} as QueryResult<T>), []);

	if (key === undefined) {
		return;
	}

	if (!SERVER_BUILD && item && "error" in item) {
		const error = item.error;

		throw error;
	}

	function refetch() {
		const item = cache!.get(key!);
		if (!item?.promise) {
			cache!.set(key!, fn(ctx), cacheTime);
		}
	}

	if (item && "value" in item) {
		return Object.assign(queryResultReference, {
			data: item.value,
			isRefetching: !!item.promise,
			refetch,
			dataUpdatedAt: item.date,
		});
	}

	if (item?.promise) {
		throw item.promise;
	}

	const result = fn(ctx);
	cache.set(key, result, cacheTime);

	if (result instanceof Promise) {
		throw result;
	}

	return Object.assign(queryResultReference, {
		data: result,
		refetch,
		isRefetching: false,
		dataUpdatedAt: item?.date ?? Date.now(),
	});
}

function useRefetch<T>(
	queryResult: QueryResult<T> | undefined,
	options: Required<UseQueryOptions>,
) {
	const {
		refetchOnWindowFocus,
		refetchInterval,
		refetchIntervalInBackground,
		staleTime,
		refetchOnReconnect,
	} = options;

	// Refetch on window focus
	useEffect(() => {
		if (!queryResult || !refetchOnWindowFocus) return;

		function handleVisibilityChange() {
			if (
				document.visibilityState === "visible" &&
				(refetchOnWindowFocus === "always" ||
					!queryResult!.dataUpdatedAt ||
					staleTime <= Date.now() - queryResult!.dataUpdatedAt)
			) {
				queryResult!.refetch();
			}
		}

		document.addEventListener("visibilitychange", handleVisibilityChange);
		window.addEventListener("focus", handleVisibilityChange);

		return () => {
			document.removeEventListener("visibilitychange", handleVisibilityChange);
			window.removeEventListener("focus", handleVisibilityChange);
		};
	}, [refetchOnWindowFocus, queryResult, staleTime]);

	// Refetch on interval
	useEffect(() => {
		if (!refetchInterval || !queryResult) return;

		const id = setInterval(() => {
			if (
				refetchIntervalInBackground ||
				document.visibilityState === "visible"
			) {
				queryResult.refetch();
			}
		}, refetchInterval);

		return () => {
			clearInterval(id);
		};
	}, [refetchInterval, refetchIntervalInBackground, queryResult]);

	// Refetch on reconnect
	useEffect(() => {
		if (!refetchOnReconnect || !queryResult) return;

		function handleReconnect() {
			queryResult!.refetch();
		}

		window.addEventListener("online", handleReconnect);

		return () => {
			window.removeEventListener("online", handleReconnect);
		};
	}, [refetchOnReconnect, queryResult]);
}

export interface QueryFunctionContext {
	queryKey: string;
}

export interface QueryCache {
	has(key: string): boolean;
	get(key: string): CacheItem | undefined;
	set(key: string, value: any, cacheTime?: number): void;
	invalidate(key: string): void;
	subscribe(key: string, fn: () => void): () => void;
	enumerate(): Iterable<string>;
}

export interface CacheItem {
	value?: any;
	error?: any;
	promise?: Promise<any>;
	date?: number;
	subscribers: Set<() => void>;
	hydrated: boolean;
	cacheTime: number;
	evictionTimeout?: ReturnType<typeof setTimeout>;
	invalid?: boolean;
}

const QueryCacheContext = createContext<QueryCache | undefined>(undefined);

export interface QueryCacheProviderProps {
	cache: QueryCache;
	children?: ReactNode;
}

export function QueryCacheProvider(props: QueryCacheProviderProps) {
	return (
		<QueryCacheContext.Provider value={props.cache}>
			{props.children}
		</QueryCacheContext.Provider>
	);
}

export function createQueryCache(): QueryCache {
	const queryCache: Record<string, CacheItem | undefined> = Object.create(null);
	// TODO: Server cache
	const $RSC = Object.create(null);

	return {
		has(key: string) {
			return key in queryCache || key in $RSC;
		},

		get(key: string) {
			if (!queryCache[key] && key in $RSC) {
				queryCache[key] = {
					value: $RSC[key],
					subscribers: new Set(),
					date: Date.now(),
					hydrated: true,
					cacheTime: DEFAULT_QUERY_OPTIONS.cacheTime,
				};

				delete $RSC[key];
			}

			return queryCache[key];
		},

		set(
			key: string,
			valueOrPromise: any,
			cacheTime = DEFAULT_QUERY_OPTIONS.cacheTime,
		) {
			if (valueOrPromise instanceof Promise) {
				queryCache[key] ||= {
					date: Date.now(),
					hydrated: false,
					subscribers: new Set(),
					cacheTime,
				};
				queryCache[key] = {
					...queryCache[key]!,
					promise: valueOrPromise,
					cacheTime: Math.max(queryCache[key]!.cacheTime, cacheTime),
				};

				delete queryCache[key]!.invalid;

				valueOrPromise.then(
					(value) => {
						queryCache[key] = {
							...queryCache[key]!,
							value,
							hydrated: false,
							date: Date.now(),
						};
						delete queryCache[key]!.promise;

						queryCache[key]!.subscribers.forEach((subscriber) => subscriber());
					},
					(error) => {
						delete queryCache[key]!.promise;
						queryCache[key]!.error = error;
						throw error;
					},
				);
			} else {
				queryCache[key] ||= {
					date: Date.now(),
					hydrated: false,
					subscribers: new Set(),
					cacheTime,
				};
				queryCache[key] = {
					...queryCache[key]!,
					value: valueOrPromise,
					hydrated: false,
					date: Date.now(),
				};

				delete queryCache[key]!.invalid;
				delete queryCache[key]!.promise;
			}

			queryCache[key]!.subscribers.forEach((subscriber) => subscriber());
		},

		subscribe(key: string, fn: () => void) {
			queryCache[key] ||= {
				subscribers: new Set(),
				date: Date.now(),
				hydrated: false,
				cacheTime: DEFAULT_QUERY_OPTIONS.cacheTime,
			};
			queryCache[key]!.subscribers.add(fn);
			if (queryCache[key]!.evictionTimeout !== undefined) {
				clearTimeout(queryCache[key]!.evictionTimeout);
				delete queryCache[key]!.evictionTimeout;
			}

			return () => {
				if (!queryCache[key]) return;
				queryCache[key]!.subscribers.delete(fn);
				if (queryCache[key]!.subscribers.size === 0) {
					delete queryCache[key]!.error;

					if (queryCache[key]!.cacheTime === 0) {
						delete queryCache[key];
					} else if (isFinite(queryCache[key]!.cacheTime)) {
						queryCache[key]!.evictionTimeout = setTimeout(() => {
							delete queryCache[key];
						}, queryCache[key]!.cacheTime);
					}
				}
			};
		},

		enumerate() {
			return Object.keys(queryCache);
		},

		invalidate(key: string) {
			if (queryCache[key]) {
				queryCache[key] = {
					...queryCache[key]!,
					invalid: true,
				};
				queryCache[key]!.subscribers.forEach((subscriber) => subscriber());
			}
		},
	};
}

declare global {
	// eslint-disable-next-line no-var
	var SERVER_BUILD: boolean;
}
