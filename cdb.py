from typing import Dict, Any
import requests
import numpy as np
from astropy.table import Table
from time import sleep
from random import random
from functools import lru_cache


class ConsDB:
    """Lightweight ConsDB client.

    Parameters
    ----------
    token : str
        RSP access token.
    server : str, optional
        ConsDB server URL, by default "https://usdf-rsp.slac.stanford.edu"
    """

    def __init__(self, token: str, server: str = "https://usdf-rsp.slac.stanford.edu") -> None:
        self.server = server
        self.token = token
        self.auth = ("user", token)
        self.url = f"{self.server}/consdb/query"

    @lru_cache()
    def _query(self, query: str) -> Dict[str, Any]:
        """Execute a cached query against ConsDB.

        Parameters
        ----------
        query : str
            SQL query to execute

        Returns
        -------
        Dict[str, Any]
            JSON response from the ConsDB API containing query results
        """
        params = {"query": query}
        response = requests.post(
            self.url, auth=self.auth, json=params, timeout=30
        )
        response.raise_for_status()
        return response.json()

    def query(self, query: str, n_retries: int = 3) -> Table:
        """Query ConsDB with retry logic.

        Parameters
        ----------
        query : str
            SQL query to execute.
        n_retries : int, optional
            Number of retry attempts for the query, by default 3

        Returns
        -------
        astropy.table.Table
            Table with results of query.

        Raises
        ------
        ValueError
            If no data is returned from the query
        requests.RequestException
            If unable to retrieve data after the specified number of retries
        """
        attempt = 0
        while attempt < n_retries:
            attempt += 1
            try:
                response_data = self._query(query)
                columns = response_data["columns"]
                data = response_data["data"]

                if not columns or not data:
                    raise ValueError(f"No data returned for query: {query}")

                table = Table(names=columns, data=np.array(data))
                return table

            except (requests.RequestException, ValueError, KeyError) as e:
                if attempt == n_retries:
                    raise
                sleep(0.5 + random())
                continue

        # This should never be reached due to the raise in the except block
        raise requests.RequestException(f"Failed to execute query after {n_retries} retries")