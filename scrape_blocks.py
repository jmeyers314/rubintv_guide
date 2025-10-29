#!/usr/bin/env python3
"""
Script to scrape observation blocks from LSSTCam data and export to JSON.

This script queries the Butler database for LSSTCam exposure records,
groups them into observation blocks based on science program and timing gaps,
and exports the block information to blocks.json for use in the RubinTV guide.
"""

import json
from typing import List, Tuple
import astropy.units as u
from astropy.table import QTable
from astropy.time import Time
from lsst.daf.butler import Butler


def query_exposures(butler: Butler, start_date: str = "20250401", end_date: str = "20280101") -> QTable:
    """
    Query exposure records from Butler.

    Parameters
    ----------
    butler : Butler
        Butler instance for database access
    start_date : str, optional
        Start date in YYYYMMDD format, by default "20250401"
    end_date : str, optional
        End date in YYYYMMDD format (exclusive), by default "20280101"

    Returns
    -------
    QTable
        Table of exposure data
    """
    # Query dimension records
    drs = butler.query_dimension_records(
        "exposure",
        where=f"exposure.day_obs >= {start_date}",
        order_by="exposure.id",
        limit=None
    )

    # Convert to dictionary format
    data = {}
    for key in drs[0].toDict().keys():
        if key == 'timespan':
            data["begin"] = [dr.timespan.begin for dr in drs]
            data["end"] = [dr.timespan.end for dr in drs]
        else:
            data[key] = [getattr(dr, key) for dr in drs]

    # Create table and filter out erroneous entries
    table = QTable(data)
    table = table[table["day_obs"] < int(end_date)]

    return table


def group_into_blocks(table: QTable, max_gap: u.Quantity = 15*u.min) -> List[Tuple[str, int, int, Time, Time]]:
    """
    Group exposures into observation blocks.

    Parameters
    ----------
    table : QTable
        Table of exposure data
    max_gap : u.Quantity, optional
        Maximum time gap between exposures in same block, by default 15*u.min

    Returns
    -------
    List[Tuple[str, int, int, Time, Time]]
        List of block tuples containing (program, seq0, seq1, begin, end)
    """
    blocks = []
    table["block"] = -999
    block_id = 0

    begin_row = table[0]

    for i, row in enumerate(table):
        if i == 0:
            continue

        previous_row = table[i-1]

        # Check if we should continue the current block
        same_program = row["science_program"] == previous_row["science_program"]
        gap_ok = row["delay"] < max_gap
        not_last = i != len(table) - 1

        if same_program and gap_ok and not_last:
            continue

        # End of block reached
        end_row = row if i == len(table) - 1 else previous_row

        # Create block tuple (only include data that's actually used in export)
        block_data = (
            end_row["science_program"],
            begin_row["seq_num"],
            end_row["seq_num"],
            begin_row["begin"],
            end_row["end"]
        )
        blocks.append(block_data)

        # Mark rows belonging to this block
        table["block"][begin_row.index:end_row.index+1] = block_id

        # Start new block
        begin_row = row
        block_id += 1

    return blocks


def export_blocks_to_json(blocks: List[Tuple[str, int, int, Time, Time]], filename: str = "blocks.json") -> None:
    """
    Export blocks to JSON format.

    Parameters
    ----------
    blocks : List[Tuple[str, int, int, Time, Time]]
        List of block tuples containing (program, seq0, seq1, begin, end)
    filename : str, optional
        Output filename, by default "blocks.json"
    """
    data = []
    for program, seq0, seq1, begin, end in blocks:
        block_dict = {
            "program": program,
            "begin": begin.isot + "Z",
            "end": end.isot + "Z",
            "seq_num_0": int(seq0),
            "seq_num_1": int(seq1),
        }
        data.append(block_dict)

    with open(filename, "w") as f:
        json.dump(data, f, indent=2)

    print(f"Exported {len(data)} blocks to {filename}")


def main() -> None:
    """Main function to orchestrate the data processing."""
    print("Starting block scraping process...")

    # Initialize Butler and query data
    butler = Butler("/repo/main", instrument="LSSTCam")
    table = query_exposures(butler)
    print(f"Queried {len(table)} exposure records")

    # Calculate delays between consecutive exposures
    table["delay"] = 0.0 * u.min
    table["delay"][1:] = table["begin"][1:] - table["end"][:-1]

    # Group into blocks
    blocks = group_into_blocks(table)
    print(f"Grouped into {len(blocks)} observation blocks")

    # Export results
    export_blocks_to_json(blocks)

    print("Block scraping completed successfully!")


if __name__ == "__main__":
    main()