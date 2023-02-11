import { useQuery, QueryCacheProvider, createQueryCache } from "good-boy";
import { Suspense } from "react";

const queryCache = createQueryCache();

export function App() {
	return (
		<QueryCacheProvider cache={queryCache}>
			<Suspense fallback={<p>Loading...</p>}>
				<Inner />
			</Suspense>
		</QueryCacheProvider>
	);
}

function Inner() {
	const { data, refetch, isRefetching } = useQuery(
		"key",
		() =>
			new Promise<string>((resolve) =>
				setTimeout(() => resolve("Fetched at " + new Date()), 1000),
			),
	);

	return (
		<div>
			<p>{data}</p>
			<button onClick={refetch}>Refetch</button>
			{isRefetching && <p>Refetching...</p>}
		</div>
	);
}
