#!/usr/bin/env python3
"""
Script to scrape observation blocks from LSSTCam data and export to JSON.

This script queries the Butler database for LSSTCam exposure records,
groups them into observation blocks based on science program and timing gaps,
and exports the block information to blocks.json for use in the RubinTV guide.
"""

import argparse
import json
import logging
from typing import List, Tuple, Optional
import astropy.units as u
from astropy.table import QTable
from astropy.time import Time
from pathlib import Path
from cdb import ConsDB


# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)


def get_rsp_token(token_path: Optional[str] = None) -> str:
    """
    Read RSP token from file.

    Parameters
    ----------
    token_path : str, optional
        Path to token file. If None, uses default path.

    Returns
    -------
    str
        RSP token

    Raises
    ------
    FileNotFoundError
        If token file doesn't exist
    """
    if token_path is None:
        token_path = "~/.lsst/rsp_token"

    tokenfile = Path(token_path).expanduser()
    if not tokenfile.exists():
        raise FileNotFoundError(f"RSP token file not found at {tokenfile}. Please ensure the token file exists.")

    with open(tokenfile, "r") as f:
        return f.read().strip()


def query_exposure_records(
    token: str,
    start_date: str = "20250401",
    end_date: str = "20280101"
) -> QTable:
    """
    Query exposure records from ConsDB.

    Parameters
    ----------
    token : str
        RSP access token
    start_date : str, optional
        Start date in YYYYMMDD format, by default "20250401"
    end_date : str, optional
        End date in YYYYMMDD format (exclusive), by default "20280101"

    Returns
    -------
    QTable
        Table of exposure data

    Raises
    ------
    ValueError
        If date format is invalid
    """
    # Validate date format
    try:
        start_exposure_id = int(f"{start_date}00000")
        end_exposure_id = int(f"{end_date}00000")
    except ValueError:
        raise ValueError(f"Invalid date format. Expected YYYYMMDD, got start_date='{start_date}', end_date='{end_date}'")

    logging.info(f"Querying exposure records from {start_date} to {end_date}")

    cdb = ConsDB(token)
    query = (
        "SELECT exposure_id, day_obs, seq_num, science_program, observation_reason, obs_start, obs_end "
        "FROM cdb_lsstcam.exposure "
        f"WHERE exposure_id > {start_exposure_id} AND exposure_id < {end_exposure_id} "
        "ORDER BY exposure_id ASC"
    )

    try:
        records = QTable(cdb.query(query))
        logging.info(f"Retrieved {len(records)} exposure records")
    except Exception as e:
        logging.error(f"Failed to query exposure records: {e}")
        raise

    records["begin"] = Time(records["obs_start"])
    records["end"] = Time(records["obs_end"])
    records["begin"].format = "jd"
    records["end"].format = "jd"
    records["delay"] = 0.0 * u.min
    records["delay"][1:] = records["begin"][1:] - records["end"][:-1]

    return records


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

    Raises
    ------
    ValueError
        If table is empty or missing required columns
    """
    if len(table) == 0:
        logging.warning("Empty table provided to group_into_blocks")
        return []

    required_columns = ["science_program", "seq_num", "begin", "end", "delay"]
    missing_columns = [col for col in required_columns if col not in table.colnames]
    if missing_columns:
        raise ValueError(f"Table missing required columns: {missing_columns}")

    logging.info(f"Grouping {len(table)} exposures into blocks with max gap of {max_gap}")

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

    logging.info(f"Created {len(blocks)} observation blocks")
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

    Raises
    ------
    IOError
        If unable to write to output file
    """
    logging.info(f"Exporting {len(blocks)} blocks to {filename}")

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

    try:
        with open(filename, "w") as f:
            json.dump(data, f, indent=2)
        logging.info(f"Successfully exported {len(data)} blocks to {filename}")
    except IOError as e:
        logging.error(f"Failed to write to {filename}: {e}")
        raise


def print_block_statistics(blocks: List[Tuple[str, int, int, Time, Time]]) -> None:
    """
    Print useful statistics about the blocks.

    Parameters
    ----------
    blocks : List[Tuple[str, int, int, Time, Time]]
        List of block tuples
    """
    if not blocks:
        logging.info("No blocks to analyze")
        return

    programs = [block[0] for block in blocks]
    unique_programs = set(programs)

    logging.info(f"Block Statistics:")
    logging.info(f"  Total blocks: {len(blocks)}")
    logging.info(f"  Unique programs: {len(unique_programs)}")

    for program in sorted(unique_programs):
        count = programs.count(program)
        logging.info(f"    {program}: {count} blocks")


def parse_arguments() -> argparse.Namespace:
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="Scrape observation blocks from LSSTCam data and export to JSON"
    )
    parser.add_argument(
        "--start-date",
        default="20250401",
        help="Start date in YYYYMMDD format (default: %(default)s)"
    )
    parser.add_argument(
        "--end-date",
        default="20280101",
        help="End date in YYYYMMDD format (default: %(default)s)"
    )
    parser.add_argument(
        "--max-gap",
        type=float,
        default=15.0,
        help="Maximum gap between exposures in same block (minutes, default: %(default)s)"
    )
    parser.add_argument(
        "--output",
        default="blocks.json",
        help="Output filename (default: %(default)s)"
    )
    parser.add_argument(
        "--token-path",
        help="Path to RSP token file (default: ~/.lsst/rsp_token)"
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable verbose logging"
    )
    return parser.parse_args()


def main() -> None:
    """Main function to orchestrate the data processing."""
    args = parse_arguments()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    try:
        logging.info("Starting block scraping process...")

        # Get token
        token = get_rsp_token(args.token_path)

        # Query records
        records = query_exposure_records(
            token=token,
            start_date=args.start_date,
            end_date=args.end_date
        )

        # Group into blocks
        max_gap = args.max_gap * u.min
        blocks = group_into_blocks(records, max_gap=max_gap)

        # Print statistics
        print_block_statistics(blocks)

        # Export results
        export_blocks_to_json(blocks, filename=args.output)
        logging.info("Block scraping completed successfully!")

    except Exception as e:
        logging.error(f"Block scraping failed: {e}")
        raise


if __name__ == "__main__":
    main()